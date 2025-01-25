"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { D3Graph } from './d3-graph'
import { calculateCurrentState, createStateMachine } from "@/lib/fsm"
import { NodeDetailsDialog } from './node-details-dialog'
import { FSMDefinitionModal } from './fsm-definition-modal'
import { StateHistory } from './state-history'
import { fetchFromDb } from "~~/utils/api"
import { handleEventAndGenerateMessages } from "@/utils/stateAndMessageHandler"
import { Card } from "@/components/ui/card"
import MessageRules from './message-rules'
import { useRouter } from 'next/navigation'
import StateGraph from './state-graph'
import { Play } from 'lucide-react'
import { ActionExecutionList } from './action-execution-list'

interface Message {
  id: string;
  type: string;
  timestamp: string;
  title: string;
  content: string;
  fromEvent?: string;
}

interface ProcedureStateProps {
  definitionProp: string;
  procedureId: string;
  params: { id: string };
  template?: {
    documents?: {
      contracts?: Array<{
        id: string;
        name: string;
        type: string;
        content: string;
        linkedStates?: string[];
      }>;
    };
    states?: {
      [key: string]: {
        description?: string;
        actions?: string[];
      };
    };
    actions?: {
      [key: string]: string[];
    };
  };
}

interface StateTransition {
  id: string;
  timestamp: string;
  message: string;
  fromState: string;
  toState: string;
  messageId?: string;
}

export const ProcedureState: React.FC<ProcedureStateProps> = ({ 
  definitionProp, 
  procedureId,
  params,
  template = { documents: { contracts: [] }, states: {} }
}) => {
  const [definition, setDefinition] = useState<string>(
    definitionProp?.replace(/;\s*/g, ';\n') || `
      idle 'start' -> processing;
      success 'reset' -> failure;
      processing 'complete' -> success;
      processing 'fail' -> failure;
      failure 'retry' -> idle;
    `
  )

  const [stateMachine, setStateMachine] = useState(() => createStateMachine(definition))
  const [events, setEvents] = useState<Event[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [currentState, setCurrentState] = useState(() => 
    calculateCurrentState(definition, messages, null, template)
  )
  const [selectedNode, setSelectedNode] = useState(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [focusedState, setFocusedState] = useState<string | null>(null)
  const graphRef = useRef<any>(null)
  const [stateHistory, setStateHistory] = useState<StateTransition[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [generatedMessages, setGeneratedMessages] = useState<Message[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const messageRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Add state for action status
  const [actionStatus, setActionStatus] = useState<{
    expectedActions: any[];
    executedActions: any[];
    pendingActions: any[];
  }>({
    expectedActions: [],
    executedActions: [],
    pendingActions: []
  });

  console.log('Template being passed to StateGraph:', template); // Debug log

  // Load events and process them
  useEffect(() => {
    const loadAndProcessEvents = async () => {
      try {
        const data = await fetchFromDb()
        const instance = data.procedureInstances.find((p: any) => p.instanceId === procedureId)
        const template = data.procedureTemplates?.find(
          (t: any) => t.templateId === instance?.templateId
        )

        if (!instance || !template) {
          console.error('Instance or template not found')
          return
        }

        // Load executed actions from DB
        const executedActions = instance.history?.executedActions || []
        console.log('Loading executed actions from DB:', executedActions)

        // Update action status with DB data
        setActionStatus(prev => ({
          ...prev,
          expectedActions: executedActions,  // Show executed actions as expected
          executedActions: executedActions,  // Store executed actions
          pendingActions: []                 // No pending actions initially
        }))

        const events = instance.history?.events || []
        setEvents(events)

        console.log('Processing events for state calculation:', events)

        let processedState = 'idle'
        const machine = createStateMachine(definition)
        machine.go(processedState)

        console.log('Starting state:', processedState)

        // Process all events to get final state
        for (const event of events) {
          console.log('\nProcessing event:', {
            id: event.id,
            type: event.type,
            currentState: processedState
          })

          const result = handleEventAndGenerateMessages(
            event,
            template.messageRules || [],
            instance.variables || {},
            processedState,
            definition
          )

          console.log('Event processing result:', {
            messages: result.messages,
            transitions: result.transitions
          })

          // Process state transition
          const messageType = result.messages[0]?.type
          if (messageType) {
            console.log('Attempting transition with:', {
              fromState: processedState,
              messageType
            })

            const actionResult = machine.action(messageType)
            if (actionResult) {
              const newState = machine.state()
              console.log('Transition successful:', {
                from: processedState,
                to: newState,
                trigger: messageType
              })
              processedState = newState
            } else {
              console.log('Transition failed - no valid transition for:', {
                state: processedState,
                messageType
              })
            }
          } else {
            console.log('No message type found for transition')
          }
        }

        console.log('\nFinal state calculation:', {
          initialState: 'idle',
          events: events.length,
          finalState: processedState
        })

        setCurrentState(processedState)

        // Process messages and transitions for history display
        let allMessages = []
        let allTransitions = []

        // Reset machine for history processing
        machine.go('idle')
        processedState = 'idle'

        for (const event of events) {
          const previousState = processedState
          const result = handleEventAndGenerateMessages(
            event,
            template.messageRules || [],
            instance.variables || {},
            processedState,
            definition
          )

          const messageType = result.messages[0]?.type
          if (messageType) {
            const actionResult = machine.action(messageType)
            if (actionResult) {
              processedState = machine.state()
            }
          }

          // Create unique message ID using timestamp
          const messageId = `msg_${event.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

          allMessages.push(...result.messages.map(msg => ({
            ...msg,
            id: messageId, // Unique ID for each message
            timestamp: msg.timestamp || event.timestamp || new Date().toISOString(),
            title: msg.type || 'Event',
            type: msg.type,
            content: msg.content || `Transition from ${previousState} to ${processedState}`
          })))

          allTransitions.push({
            id: messageId, // Same unique ID for corresponding transition
            timestamp: event.timestamp || new Date().toISOString(),
            message: messageType || 'unknown',
            type: messageType,
            title: event.type || messageType || '',
            fromState: previousState,
            toState: processedState,
            messageId: messageId
          })
        }

        setGeneratedMessages(allMessages)
        setStateHistory(allTransitions)
        setMessages(allMessages)

      } catch (error) {
        console.error('Error loading events:', error)
      }
    }

    loadAndProcessEvents()
  }, [procedureId, definition])

  // Extract nodes and transitions from the state machine
  const nodes = useMemo(() => {
    // Get all unique states from the FSM definition
    const stateSet = new Set<string>()
    

    definition.split(';').forEach(line => {
      line = line.trim()
      if (line) {
        // Extract source state
        const sourceState = line.split(/\s+/)[0]
        // Extract target state (after '-> ')
        const targetState = line.split('->')[1]?.trim()
        
        if (sourceState) stateSet.add(sourceState)
        if (targetState) stateSet.add(targetState)
      }
    })

    // Find final states (states with no outgoing transitions)
    const finalStates = new Set(Array.from(stateSet))
    definition.split(';').forEach(line => {
      line = line.trim()
      if (line) {
        const sourceState = line.split(/\s+/)[0]
        finalStates.delete(sourceState)
      }
    })

    console.log('States found:', Array.from(stateSet))
    console.log('Template actions:', template?.actions)
    
    return Array.from(stateSet).map(state => ({
      id: state,
      isActive: state === currentState,
      isInitial: state === 'idle',
      isFinal: finalStates.has(state),
      metadata: {
        actions: template?.actions?.[state] || [],
        description: `State: ${state}${template?.actions?.[state] ? 
          '\nActions: ' + template.actions[state].length : 
          '\nNo actions'}`
      }
    }))
  }, [definition, currentState, template?.actions])

  const links = useMemo(() => {
    const transitionLinks: { source: string; target: string; label: string }[] = []
    
    // Parse each line of the definition
    definition.split(';').forEach(line => {
      line = line.trim()
      if (!line) return

      // Match pattern: sourceState 'eventName' -> targetState
      const match = line.match(/(\w+)\s+'([^']+)'\s*->\s*(\w+)/)
      if (match) {
        const [, source, event, target] = match
        transitionLinks.push({
          source,
          target,
          label: event
        })
      }
    })

    console.log('Transitions found:', transitionLinks)
    return transitionLinks
  }, [definition])

  // Debug logs
  console.log('Current State:', currentState)
  console.log('Graph Nodes:', nodes)
  console.log('Graph Links:', links)

  const handleDefinitionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDefinition = e.target.value
    setDefinition(newDefinition)
    try {
      const newStateMachine = createStateMachine(newDefinition)
      setStateMachine(newStateMachine)
      setCurrentState(calculateCurrentState(newDefinition, messages, null, template))
    } catch (error) {
      console.error("Invalid state machine definition", error)
    }
  }

  const handleSendMessage = (messageType: string) => {
    try {
      const previousState = currentState
      const machine = createStateMachine(definition)
      machine.go(previousState)
      
      const actionResult = machine.action(messageType)
      if (!actionResult) {
        console.warn(`Action "${messageType}" is invalid for current state ${currentState}`)
        return
      }

      const newState = machine.state()
      const timestamp = new Date().toISOString()
      const messageId = `msg_${Date.now()}`
      
      const newMessage: Message = {
        id: messageId,
        type: messageType,
        timestamp,
        title: messageType,
        content: `Transition: ${previousState} -> ${newState}`
      }

      const newTransition: StateTransition = {
        id: messageId,
        timestamp,
        message: messageType,
        type: messageType,
        title: messageType,
        fromState: previousState,
        toState: newState,
        messageId: messageId
      }

      setMessages(prev => [...prev, newMessage])
      setStateHistory(prev => [...prev, newTransition])
      setCurrentState(newState)
      
      console.log('New transition added:', newTransition)
    } catch (error) {
      console.error("Error during state transition:", error)
    }
  }

  const handleNodeClick = (node: any) => {
    if (!node) {
      console.error('No node data provided to handleNodeClick');
      return;
    }

    console.log('Clicked node:', node);
    setSelectedNode(node);
    setIsDialogOpen(true);
    
    if (node.id) {
      setFocusedState(node.id);
      if (graphRef.current?.focusOnState) {
        graphRef.current.focusOnState(node.id);
      }
    }
  };

  const handleFocusState = (state: string) => {
    setFocusedState(prev => prev === state ? null : state)
    if (graphRef.current?.focusOnState && state !== focusedState) {
      graphRef.current.focusOnState(state)
    }
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      setFocusedState(null)
    }
  }

  const scrollToMessage = (messageId: string) => {
    setSelectedMessageId(messageId)
    // Navigate to messages tab with highlight parameter
    router.push(`/procedures/${procedureId}?tab=messages&highlight=${messageId}`)
    
    // Use setTimeout to wait for navigation before scrolling
    setTimeout(() => {
      const messageElement = document.getElementById(`message-${messageId}`)
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        messageElement.classList.add('flash-highlight')
        setTimeout(() => messageElement.classList.remove('flash-highlight'), 1000)
      }
    }, 100)
  }

  const checkAndExecuteStateActions = async (
    state: string, 
    trigger: string, 
    previousState: string,
    updatedInstance: any,
    template: any
  ) => {
    // Get actions for this state
    const stateActions = template.actions?.[state] || [];
    
    console.log('Checking actions for state:', {
      state,
      trigger,
      stateActionsRaw: template.actions?.[state], // Debug raw actions
      availableActions: stateActions,
      executedActions: updatedInstance.history.executedActions
    });

    // Find pending actions
    const pendingActions = stateActions.filter((action: any) => {
      console.log('Checking action:', action); // Debug each action

      // Default to enabled if not specified
      if (action.enabled === undefined) {
        action.enabled = true;
      }

      const hasBeenExecuted = updatedInstance.history.executedActions.some(
        (executed: any) => 
          executed.actionId === action.id && 
          executed.state === state &&
          executed.trigger === trigger
      );
      
      const shouldExecute = !hasBeenExecuted && action.enabled;
      console.log('Action execution check:', {
        actionId: action.id,
        hasBeenExecuted,
        enabled: action.enabled,
        shouldExecute
      });
      
      return shouldExecute;
    });

    console.log('Pending actions for state:', {
      state,
      pendingActionsCount: pendingActions.length,
      pendingActions
    });

    // Execute pending actions
    for (const action of pendingActions) {
      try {
        console.log('Executing action:', action);

        const actionEvent = {
          id: `evt_${Date.now()}`,
          ...action.template.data,
          timestamp: new Date().toISOString(),
          source: action.id,
          transition: {
            from: previousState,
            to: state,
            trigger
          }
        };

        console.log('Created action event:', actionEvent);

        const response = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: actionEvent,
            action: 'add',
            procedureId
          })
        });

        if (response.ok) {
          // Record the execution
          const executionRecord = {
            actionId: action.id,
            state,
            trigger,
            timestamp: new Date().toISOString(),
            eventId: actionEvent.id
          };

          console.log('Recording action execution:', executionRecord);

          updatedInstance.history.executedActions.push(executionRecord);

          // Update instance
          const updateResponse = await fetch('/api/procedures/' + procedureId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              history: updatedInstance.history
            })
          });

          if (!updateResponse.ok) {
            console.error('Failed to update instance with execution record');
          }
        } else {
          console.error('Failed to create action event');
        }
      } catch (error) {
        console.error('Error executing action:', error);
      }
    }

    return pendingActions.length > 0; // Return whether any actions were executed
  };

  const getActionsForState = (state: string, template: any) => {
    const stateActions = template.actions?.[state] || [];
    return stateActions.map((action: any) => ({
      actionId: action.id,
      state,
      type: action.type,
      enabled: action.enabled ?? true
    }));
  };

  const handleRunMachine = async () => {
    try {
      const data = await fetchFromDb();
      const instance = data.procedureInstances.find((p: any) => p.instanceId === procedureId);
      const template = data.procedureTemplates?.find(
        (t: any) => t.templateId === instance?.templateId
      );

      if (!instance || !template) {
        console.error('Instance or template not found');
        return;
      }

      // Initialize instance structure
      const updatedInstance = {
        ...instance,
        history: {
          ...instance.history,
          executedActions: instance.history?.executedActions || []
        }
      };

      // Calculate all actions that should have been executed
      let expectedActions = [];
      let currentState = 'idle';
      const machine = createStateMachine(definition);
      machine.go(currentState);

      console.log('Starting action calculation from:', currentState);

      // Add initial state actions
      if (template.actions?.[currentState]) {
        expectedActions.push(...template.actions[currentState].map(action => ({
          actionId: action.id || `action_${Date.now()}`,
          state: currentState,
          trigger: 'INIT',
          type: action.type || 'UNKNOWN',
          timestamp: new Date().toISOString()
        })));
      }

      // Process each event to track state changes and required actions
      for (const message of messages) {
        const previousState = currentState;
        const actionResult = machine.action(message.type);
        
        if (actionResult) {
          currentState = machine.state();
          console.log(`State transition: ${previousState} -> ${currentState} (${message.type})`);

          // Add actions for the new state
          if (template.actions?.[currentState]) {
            expectedActions.push(...template.actions[currentState].map((action: any) => ({
              actionId: action.id || `action_${Date.now()}`,
              state: currentState,
              trigger: message.type || 'INIT',
              type: action.type || 'UNKNOWN',
              name: action.type || 'UNKNOWN'
            })));
          }
        }
      }

      // Compare with executed actions
      const executedActionKeys = new Set(
        updatedInstance.history.executedActions.map(
          (a: any) => `${a.actionId}_${a.state}_${a.trigger}`
        )
      );

      const pendingActions = expectedActions.filter(action => {
        const actionKey = `${action.actionId}_${action.state}_${action.trigger}`;
        return !executedActionKeys.has(actionKey);
      });

      console.log('Action analysis:', {
        currentState,
        expectedActions,
        executedActions: updatedInstance.history.executedActions,
        pendingActions
      });

      if (pendingActions.length > 0) {
        // Store actions in DB
        const updatedActions = [
          ...updatedInstance.history.executedActions,
          ...pendingActions.map(action => ({
            actionId: action.actionId,
            state: action.state, 
            trigger: action.trigger || 'UNKNOWN',
            type: action.type || 'UNKNOWN',
            name: action.type || 'UNKNOWN',
            timestamp: new Date().toISOString()
          }))
        ];

        // Store actions
        const response = await fetch('/api/procedures/' + procedureId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: {
              ...instance.history,
              executedActions: updatedActions
            }
          })
        });

        if (!response.ok) {
          console.error('Failed to store actions');
        }
      }

      // Update UI
      setActionStatus({
        expectedActions,
        executedActions: updatedInstance.history.executedActions,
        pendingActions
      });

    } catch (error) {
      console.error('Error analyzing actions:', error);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-6" onClick={handleContainerClick} ref={containerRef}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">State Machine Visualization</h3>
          <div className="flex gap-2">
            <Button 
              onClick={handleRunMachine}
              variant="default"
              className="bg-primary text-white hover:bg-primary/90"
            >
              <Play className="h-4 w-4 mr-2" />
              Run Machine
            </Button>
            <FSMDefinitionModal 
              definition={definition}
              onChange={(value: string) => handleDefinitionChange({ target: { value } } as React.ChangeEvent<HTMLTextAreaElement>)}
            />
          </div>
        </div>

        <div className="w-full bg-white rounded-lg shadow-lg p-4">
          <D3Graph
            ref={graphRef}
            nodes={nodes.map(node => ({
              ...node,
              highlight: node.id === focusedState
            }))}
            links={links}
            width={800}
            height={500}
            direction="LR"
            onNodeClick={(node: any) => {
              console.log('Node clicked:', node);
              if (node) {
                handleNodeClick(node);
              } else {
                // Deselect when clicking empty space
                setFocusedState(null);
              }
            }}
            documents={template?.documents}
          />
          
        </div>


        <div className="space-y-4">
          <h3 className="text-lg font-medium">State Transition History {procedureId}</h3>
          <StateHistory 
            transitions={stateHistory}
            onFocusState={handleFocusState}
            focusedState={focusedState}
            onMessageClick={scrollToMessage}
          />
        </div>

        <ActionExecutionList 
          expectedActions={actionStatus.expectedActions}
          executedActions={actionStatus.executedActions}
          pendingActions={actionStatus.pendingActions}
        />
      </div>

      <NodeDetailsDialog
        node={selectedNode}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        documents={template?.documents}
        procedureId={params.id}
      />
    </>
  )
}

export default ProcedureState
