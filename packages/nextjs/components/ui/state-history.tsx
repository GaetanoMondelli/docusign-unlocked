import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"
import { Button } from "./button"
import { Eye } from "lucide-react"

interface StateTransition {
  id: string;
  timestamp: string;
  message: string;
  fromState: string;
  toState: string;
  type?: string;
  title?: string;
}

interface StateHistoryProps {
  transitions: StateTransition[];
  onFocusState: (state: string) => void;
  focusedState: string | null;
}

export const StateHistory = ({ transitions, onFocusState, focusedState }: StateHistoryProps) => {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Transition</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transitions.map((transition) => {
            const isStateFocused = focusedState === transition.toState;
            return (
              <TableRow key={transition.id}>
                <TableCell className="font-mono">
                  {new Date(transition.timestamp).toLocaleTimeString()}
                </TableCell>
                <TableCell>{transition.type || transition.message}</TableCell>
                <TableCell>{transition.title || '-'}</TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{transition.fromState}</span>
                  <span className="mx-2">→</span>
                  <span className="font-medium">{transition.toState}</span>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onFocusState(transition.toState)}
                    title="Focus on this state"
                    className={isStateFocused ? "bg-primary/20" : ""}
                  >
                    <Eye 
                      className={`h-4 w-4 ${isStateFocused ? "text-primary" : ""}`} 
                    />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}; 