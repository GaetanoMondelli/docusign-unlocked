"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { D3Graph } from '../ui/d3-graph'
import { createStateMachine } from "@/lib/fsm"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createHash } from 'crypto'
import { ChevronDown, ChevronRight, PlusCircle, Loader2, HelpCircle } from "lucide-react"
import { fetchFromDb, updateDb } from "~~/utils/api"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface Step {
  title: string
  description: string
}

interface Variable {
  type: string;
  required: boolean;
}

interface Variables {
  [key: string]: {
    [key: string]: Variable;
  };
}

interface EventType {
  type: string;
  schema: {
    [key: string]: string;
  };
}

type ActionType = 'SEND_EMAIL' | 'CALL_API' | 'DOCUSIGN_EVENT';

interface StateAction {
  type: ActionType;
  config: {
    // For email
    to?: string;
    subject?: string;
    body?: string;
    // For API
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: any;
    // For DocuSign
    eventType?: string;
    envelopeId?: string;
  };
}

interface StateActions {
  [state: string]: StateAction[];
}

const DEFAULT_VARIABLES: Variables = {
  candidate: {
    email: { type: "string", required: true },
    name: { type: "string", required: true }
  },
  company: {
    email: { type: "string", required: true },
    department: { type: "string", required: true }
  }
}

const DEFAULT_EVENT_TYPES: EventType[] = [
  {
    type: "EMAIL_RECEIVED",
    schema: {
      from: "string",
      to: "string",
      subject: "string",
      body: "string",
      time: "string"
    }
  },
  {
    type: "DOCUMENT_UPLOADED",
    schema: {
      filename: "string",
      type: "string",
      url: "string"
    }
  }
]

const steps: Step[] = [
  {
    title: "Basic Information",
    description: "Start by providing a name and description for your template."
  },
  {
    title: "Variables & Event Types",
    description: "Define the variables and event types used in your workflow."
  },
  {
    title: "State Machine",
    description: "Define the states and transitions of your workflow."
  },
  {
    title: "Message Rules",
    description: "Configure how events map to state transitions."
  },
  {
    title: "State Actions",
    description: "Define automated actions for each state."
  },
  {
    title: "Review",
    description: "Review your template configuration before creating."
  }
]

const DEFAULT_FSM = `idle 'start' -> review;
review 'approve' -> approved;
review 'reject' -> rejected;
approved 'complete' -> completed;
rejected 'retry' -> review;`

const DEFAULT_RULES = [
  {
    matches: {
      type: "EMAIL_RECEIVED",
      conditions: {
        from: "{{candidate.email}}",
        to: "{{company.email}}",
        subject: "(contains) interview"
      }
    },
    captures: {
      requestTime: "{{event.data.time}}",
      requestSubject: "{{event.data.subject}}"
    },
    generates: {
      type: "contact_candidate",
      template: {
        title: "interview requested by {{candidate.name}}",
        content: "Candidate has requested an interview for {{company.department}} position",
        timestamp: "{{captures.requestTime}}"
      }
    },
    transition: {
      to: "contacting_candidate",
      conditions: {
        requestTime: "(after) {{previousState.time}}"
      }
    }
  }
]

const DEFAULT_CONTRACT = `{
  "name": "Sample Contract",
  "type": "agreement",
  "content": "This is a sample contract content",
  "linkedStates": ["review", "approved"]
}`

interface CollapsibleRuleProps {
  rule: any;
  index: number;
}

const renderMessageRule = (rule: any) => {
  return (
    <div className="bg-slate-50 rounded-lg p-4 space-y-3">
      <div className="space-y-2">
        <h4 className="font-medium text-sm">When</h4>
        <div className="bg-white rounded p-2 text-sm">
          <span className="text-blue-600">Event type:</span> {rule.matches.type}
          {Object.entries(rule.matches.conditions).map(([key, value]) => (
            <div key={key} className="ml-4">
              <span className="text-gray-600">{key}:</span> {String(value)}
            </div>
          ))}
        </div>
      </div>

      {rule.captures && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Capture</h4>
          <div className="bg-white rounded p-2 text-sm">
            {Object.entries(rule.captures).map(([key, value]) => (
              <div key={key}>
                <span className="text-gray-600">{key}:</span> {String(value)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-medium text-sm">Generate Message</h4>
        <div className="bg-white rounded p-2 text-sm">
          <div><span className="text-blue-600">Type:</span> {rule.generates.type}</div>
          <div className="ml-4">
            <div><span className="text-gray-600">Title:</span> {rule.generates.template.title}</div>
            <div><span className="text-gray-600">Content:</span> {rule.generates.template.content}</div>
          </div>
        </div>
      </div>

      {rule.transition && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Transition</h4>
          <div className="bg-white rounded p-2 text-sm">
            <div><span className="text-blue-600">To state:</span> {rule.transition.to}</div>
            {rule.transition.conditions && (
              <div className="ml-4">
                <span className="text-gray-600">When:</span>
                {Object.entries(rule.transition.conditions).map(([key, value]) => (
                  <div key={key} className="ml-2">{key} {String(value)}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const CollapsibleRule = ({ rule, index }: CollapsibleRuleProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-slate-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium text-sm">Rule {index + 1}: {rule.matches.type}</span>
        </div>
        <span className="text-sm text-gray-500">→ {rule.transition?.to || 'No transition'}</span>
      </button>
      {isOpen && (
        <div className="p-3 border-t">
          {renderMessageRule(rule)}
        </div>
      )}
    </div>
  )
}

const JsonView = ({ data }: { data: any }) => {
  const formatJson = (obj: any, indent = 0): string => {
    const space = ' '.repeat(indent * 2)

    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') return `<span class="text-green-600">"${obj}"</span>`
      if (typeof obj === 'boolean') return `<span class="text-purple-600">${obj}</span>`
      if (typeof obj === 'number') return `<span class="text-orange-600">${obj}</span>`
      return String(obj)
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]'
      const items = obj.map(item => formatJson(item, indent + 1)).join(',\n')
      return `[\n${space}  ${items}\n${space}]`
    }

    const entries = Object.entries(obj)
    if (entries.length === 0) return '{}'

    const formattedEntries = entries
      .map(([key, value]) => {
        const formattedValue = formatJson(value, indent + 1)
        return `${space}  <span class="text-blue-600">"${key}"</span>: ${formattedValue}`
      })
      .join(',\n')

    return `{\n${formattedEntries}\n${space}}`
  }

  return (
    <pre className="bg-slate-50 p-4 rounded-lg overflow-auto">
      <code
        className="text-sm"
        dangerouslySetInnerHTML={{ __html: formatJson(data) }}
      />
    </pre>
  )
}

const ANALYSIS_MODES = {
  "gpt-4-turbo-preview": "GPT-4 Turbo (Fastest)",
  "gpt-4": "GPT-4 (Most Reliable)",
  "gpt-3.5-turbo": "GPT-3.5 (Basic)",
  "expert": "Expert System Mode"
} as const;

const StateActionView = ({ state, actions }: { state: string; actions: StateAction[] }) => {
  return (
    <div className="border rounded-lg">
      <button className="w-full flex items-center justify-between p-3 bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{state}</span>
        </div>
        <span className="text-sm text-gray-500">{actions.length} action(s)</span>
      </button>
      <div className="p-3 border-t space-y-2">
        {actions.map((action, index) => (
          <div key={index} className="bg-white rounded border p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-blue-600">{action.type}</span>
            </div>
            {action.type === 'SEND_EMAIL' && (
              <div className="space-y-1 text-sm">
                <div><span className="text-gray-500">To:</span> {action.config.to}</div>
                <div><span className="text-gray-500">Subject:</span> {action.config.subject}</div>
                <div><span className="text-gray-500">Body:</span> {action.config.body}</div>
              </div>
            )}
            {action.type === 'CALL_API' && (
              <div className="space-y-1 text-sm">
                <div><span className="text-gray-500">URL:</span> {action.config.url}</div>
                <div><span className="text-gray-500">Method:</span> {action.config.method}</div>
              </div>
            )}
            {action.type === 'DOCUSIGN_EVENT' && (
              <div className="space-y-1 text-sm">
                <div><span className="text-gray-500">Event Type:</span> {action.config.eventType}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export function CreateTemplateModal() {
  const [open, setOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [documentText, setDocumentText] = useState("")
  const [fsmDefinition, setFsmDefinition] = useState(DEFAULT_FSM)
  const [messageRules, setMessageRules] = useState(JSON.stringify(DEFAULT_RULES, null, 2))
  const [isLoading, setIsLoading] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [description, setDescription] = useState("")
  const [contract, setContract] = useState(DEFAULT_CONTRACT)
  const [contractError, setContractError] = useState("")
  const [isEditingRules, setIsEditingRules] = useState(false)
  const [variables, setVariables] = useState<Variables>(DEFAULT_VARIABLES)
  const [eventTypes, setEventTypes] = useState<EventType[]>(DEFAULT_EVENT_TYPES)
  const [showVariablesModal, setShowVariablesModal] = useState(false)
  const [showEventTypesModal, setShowEventTypesModal] = useState(false)
  const [documentContent, setDocumentContent] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>("gpt-4")
  const [expertMode, setExpertMode] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<string>('')

  const handleDocumentAnalysis = async () => {
    if (!documentContent.trim()) {
      setAnalysisError('Please enter document content');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError('');
    setAnalysisProgress('');

    try {
      const response = await fetch("/api/analyze-document", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentContent,
          model: selectedModel,
          expertMode: selectedModel === "expert"
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(`Rate limit exceeded. ${data.details}`);
        }
        throw new Error(data.details || data.error || 'Failed to analyze document');
      }

      if (!data.template) {
        throw new Error('Invalid response format from server');
      }

      // Update progress if available
      if (data.progress) {
        setAnalysisProgress(data.progress);
      }

      // Update the form with the suggested template
      setFsmDefinition(data.template.stateMachine.fsl || '');
      setMessageRules(JSON.stringify(data.template.messageRules || [], null, 2));
      setVariables(data.template.variables || {});
      setTemplateName(data.template.name || '');
      setDescription(data.template.description || '');

      // Update contract with actions
      if (data.template.actions) {
        setContract(JSON.stringify({ actions: data.template.actions }, null, 2));
      } else {
        console.warn('No actions found in template response');
        setContract('{}'); // Set empty contract if no actions
      }

    } catch (error: any) {
      console.error('Error:', error);
      setAnalysisError(error.message || 'Failed to analyze document');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    try {
      // Fetch current DB state
      const db = await fetchFromDb();

      // Generate templateId using hash of name and timestamp
      const templateId = createHash('sha256')
        .update(`${templateName}_${Date.now()}`)
        .digest('hex')
        .substring(0, 12);

      const template = {
        templateId,
        name: templateName,
        description,
        variables,
        eventTypes,
        messageRules: JSON.parse(messageRules),
        stateMachine: {
          fsl: fsmDefinition,
          initial: "idle",
          final: ["completed", "terminated", "failed"],
        },
        documents: documentText ? {
          contracts: [{
            id: `doc_${templateId}`,
            name: templateName,
            type: "document",
            content: documentText,
          }]
        } : undefined
      }

      // Use the updateDb helper function
      console.log("atemplate", template)
      console.log("adb", db)

      const updatedDb = {
        ...db,
        procedureTemplates: [...(db.procedureTemplates || []), template]
      }

      await updateDb(updatedDb)


      setOpen(false)

      // Optionally refresh the page or update the templates list
      window.location.reload()
    } catch (error) {
      console.error("Error saving template:", error)
    }
  }

  const resetForm = () => {
    setCurrentStep(0)
    setDocumentText("")
    setFsmDefinition(DEFAULT_FSM)
    setMessageRules(JSON.stringify(DEFAULT_RULES, null, 2))
    setTemplateName("")
    setDescription("")
    setContract(DEFAULT_CONTRACT)
    setContractError("")
    setIsEditingRules(false)
    setVariables(DEFAULT_VARIABLES)
    setEventTypes(DEFAULT_EVENT_TYPES)
    setDocumentContent("")
  }

  const validateContract = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      if (!parsed.name || !parsed.type || !parsed.content) {
        return "Contract must include name, type, and content"
      }
      setContractError("")
      return ""
    } catch (e) {
      return "Invalid JSON format"
    }
  }

  const handleContractChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContract(value)
    setContractError(validateContract(value))
  }

  const handleAddAction = (state: string) => {
    const currentActions = JSON.parse(contract);
    if (!currentActions.actions) currentActions.actions = {};
    if (!currentActions.actions[state]) currentActions.actions[state] = [];
    
    currentActions.actions[state].push({
      type: 'SEND_EMAIL',
      config: {}
    });
    
    setContract(JSON.stringify(currentActions, null, 2));
  };

  const handleRemoveAction = (state: string, index: number) => {
    const currentActions = JSON.parse(contract);
    currentActions.actions[state].splice(index, 1);
    setContract(JSON.stringify(currentActions, null, 2));
  };

  const handleUpdateAction = (state: string, index: number, field: string, value: any) => {
    const currentActions = JSON.parse(contract);
    currentActions.actions[state][index].config[field] = value;
    setContract(JSON.stringify(currentActions, null, 2));
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Template Name</Label>
                <Input
                  id="name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Enter template name..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter template description..."
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label>Document Analysis</Label>
                  <div className="flex items-center gap-4">
                    <div className="w-48">
                      <Select
                        value={selectedModel}
                        onValueChange={setSelectedModel}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select analysis mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gpt-4-turbo-preview">GPT-4 Turbo (Fastest)</SelectItem>
                          <SelectItem value="gpt-4">GPT-4 (Most Reliable)</SelectItem>
                          <SelectItem value="gpt-3.5-turbo">GPT-3.5 (Basic)</SelectItem>
                          <SelectItem value="expert">Expert System Mode</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <p className="font-medium">Analysis Modes:</p>
                            <ul className="mt-2 list-disc list-inside text-sm">
                              <li><span className="font-medium">GPT-4 Turbo:</span> Fastest analysis, good for most cases</li>
                              <li><span className="font-medium">GPT-4:</span> More thorough but slower analysis</li>
                              <li><span className="font-medium">GPT-3.5:</span> Basic analysis, fastest and cheapest</li>
                              <li><span className="font-medium">Expert System:</span> Uses multiple specialized prompts:
                                <ul className="ml-4 mt-1 list-disc list-inside text-xs">
                                  <li>GPT-4 for state machine design</li>
                                  <li>GPT-4 Turbo for message rules</li>
                                  <li>GPT-4 Turbo for state actions</li>
                                </ul>
                              </li>
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDocumentAnalysis}
                      disabled={!documentContent || isAnalyzing}
                    >
                      {isAnalyzing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {isAnalyzing ? 'Analyzing...' : 'Analyze Document'}
                    </Button>
                  </div>
                </div>
                <div className="h-[250px] w-full rounded-md border">
                  <Textarea
                    id="document"
                    value={documentContent}
                    onChange={(e) => setDocumentContent(e.target.value)}
                    placeholder="Paste your contract, policy, or any document text here to get AI-generated suggestions for the state machine and message rules..."
                    className="h-full resize-none border-0"
                  />
                </div>
                {isAnalyzing && analysisProgress && (
                  <p className="text-sm text-muted-foreground">
                    {analysisProgress}
                  </p>
                )}
                {analysisError && (
                  <p className="text-sm text-red-500">{analysisError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Upload any document to get AI-generated suggestions for your workflow. You can edit the suggestions in the next steps.
                </p>
              </div>
            </div>
          </div>
        )

      case 1:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Variables</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingRules(!isEditingRules)}
                >
                  {isEditingRules ? "Preview" : "Edit JSON"}
                </Button>
              </div>
              {isEditingRules ? (
                <Textarea
                  value={JSON.stringify(variables, null, 2)}
                  onChange={(e) => {
                    try {
                      setVariables(JSON.parse(e.target.value))
                    } catch (error) {
                      console.error("Invalid JSON")
                    }
                  }}
                  className="h-[200px] font-mono"
                />
              ) : (
                <JsonView data={variables} />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Event Types</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingRules(!isEditingRules)}
                >
                  {isEditingRules ? "Preview" : "Edit JSON"}
                </Button>
              </div>
              {isEditingRules ? (
                <Textarea
                  value={JSON.stringify(eventTypes, null, 2)}
                  onChange={(e) => {
                    try {
                      setEventTypes(JSON.parse(e.target.value))
                    } catch (error) {
                      console.error("Invalid JSON")
                    }
                  }}
                  className="h-[200px] font-mono"
                />
              ) : (
                <JsonView data={eventTypes} />
              )}
            </div>
          </div>
        )

      case 2:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fsm">State Machine Definition</Label>
              <ScrollArea className="h-[200px] w-full rounded-md border">
                <Textarea
                  id="fsm"
                  value={fsmDefinition}
                  onChange={(e) => setFsmDefinition(e.target.value)}
                  placeholder="Define your state machine..."
                  className="min-h-[200px] border-0"
                />
              </ScrollArea>
            </div>
            {fsmDefinition && (
              <div className="border rounded-lg p-2">
                <D3Graph
                  nodes={getNodesFromFsm(fsmDefinition)}
                  links={getLinksFromFsm(fsmDefinition)}
                  width={500}
                  height={200}
                  direction="LR"
                />
              </div>
            )}
          </div>
        )

      case 3:
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>Message Rules</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditingRules(!isEditingRules)}
              >
                {isEditingRules ? "Preview" : "Edit JSON"}
              </Button>
            </div>
            {isEditingRules ? (
              <Textarea
                value={messageRules}
                onChange={(e) => setMessageRules(e.target.value)}
                className="h-[400px] font-mono"
              />
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {JSON.parse(messageRules).map((rule: any, index: number) => (
                    <CollapsibleRule key={index} rule={rule} index={index} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )

      case 4:
        const states = getNodesFromFsm(fsmDefinition).map(node => node.id);
        const currentActions = JSON.parse(contract)?.actions || {};
        
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>State Actions</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditingRules(!isEditingRules)}
              >
                {isEditingRules ? "Preview" : "Edit JSON"}
              </Button>
            </div>
            {isEditingRules ? (
              <Textarea
                value={contract}
                onChange={(e) => setContract(e.target.value)}
                className="h-[400px] font-mono"
              />
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {states.map(state => (
                    <div key={state} className="space-y-2">
                      <StateActionView 
                        state={state} 
                        actions={currentActions[state] || []} 
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full border border-dashed"
                        onClick={() => handleAddAction(state)}
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Add Action to {state}
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            {contractError && (
              <p className="text-sm text-red-500 mt-2">{contractError}</p>
            )}
          </div>
        );

      case 5:
        const reviewData = {
          templateId: createHash('sha256')
            .update(`${templateName}_${Date.now()}`)
            .digest('hex')
            .substring(0, 12),
          name: templateName,
          description,
          variables,
          eventTypes,
          messageRules: JSON.parse(messageRules),
          stateMachine: {
            fsl: fsmDefinition,
            initial: "idle",
            final: ["completed", "terminated", "failed"],
          },
          documents: documentText ? {
            contracts: [{
              id: `doc_${templateId}`,
              name: templateName,
              type: "document",
              content: documentText,
            }]
          } : undefined
        }

        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <Label>Review Template Configuration</Label>
              <Button
                onClick={handleSave}
                className="gap-2"
              >
                Create Template
              </Button>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-800">
                Please review your template configuration carefully. Once created, you'll be able to use this template to create new procedures.
              </p>
            </div>
            <ScrollArea className="h-[400px]">
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium mb-2">Basic Information</h3>
                  <JsonView data={{ name: templateName, description }} />
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Variables</h3>
                  <JsonView data={variables} />
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Event Types</h3>
                  <JsonView data={eventTypes} />
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">State Machine</h3>
                  <JsonView data={{ fsl: fsmDefinition }} />
                  <div className="mt-2 border rounded-lg p-2">
                    <D3Graph
                      nodes={getNodesFromFsm(fsmDefinition)}
                      links={getLinksFromFsm(fsmDefinition)}
                      width={450}
                      height={150}
                      direction="LR"
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Message Rules</h3>
                  <div className="space-y-2">
                    {JSON.parse(messageRules).map((rule: any, index: number) => (
                      <CollapsibleRule key={index} rule={rule} index={index} />
                    ))}
                  </div>
                </div>

                {documentText && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Document</h3>
                    <JsonView data={reviewData.documents} />
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return templateName.trim() !== "" && description.trim() !== ""
      case 1:
        return Object.keys(variables).length > 0 && eventTypes.length > 0
      case 2:
        return fsmDefinition.trim() !== ""
      case 3:
        try {
          JSON.parse(messageRules)
          return true
        } catch {
          return false
        }
      case 4:
        try {
          JSON.parse(contract)
          return true
        } catch {
          return false
        }
      default:
        return true
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <PlusCircle className="h-4 w-4" />
          Create New Template
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{steps[currentStep].title}</DialogTitle>
          <DialogDescription>{steps[currentStep].description}</DialogDescription>
        </DialogHeader>

        <div className="py-2">{renderStepContent()}</div>

        <DialogFooter>
          <div className="flex justify-between w-full">
            <Button
              variant="outline"
              onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
              disabled={currentStep === 0}
            >
              Previous
            </Button>
            <div className="space-x-2">
              <Button variant="outline" onClick={() => {
                resetForm()
                setOpen(false)
              }}>
                Cancel
              </Button>
              {currentStep !== steps.length - 1 && (
                <Button
                  onClick={() => setCurrentStep((prev) => Math.min(steps.length - 1, prev + 1))}
                  disabled={!canProceed()}
                >
                  Next
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Helper functions to convert FSM definition to graph data
function getNodesFromFsm(definition: string) {
  const stateSet = new Set<string>()

  definition.split(';').forEach(line => {
    line = line.trim()
    if (line) {
      const sourceState = line.split(/\s+/)[0]
      const targetState = line.split('->')[1]?.trim()

      if (sourceState) stateSet.add(sourceState)
      if (targetState) stateSet.add(targetState)
    }
  })

  return Array.from(stateSet).map(state => ({
    id: state,
    isInitial: state === 'idle',
  }))
}

function getLinksFromFsm(definition: string) {
  const links: { source: string; target: string; label: string }[] = []

  definition.split(';').forEach(line => {
    line = line.trim()
    if (!line) return

    const match = line.match(/(\w+)\s+'([^']+)'\s*->\s*(\w+)/)
    if (match) {
      const [, source, event, target] = match
      links.push({ source, target, label: event })
    }
  })

  return links
} 