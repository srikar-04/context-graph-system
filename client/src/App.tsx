import { ChatPanel } from "./components/ChatPanel";
import { GraphPanel } from "./components/GraphPanel";
import { useChat } from "./hooks/useChat";
import { useGraph } from "./hooks/useGraph";

const numberFormatter = new Intl.NumberFormat("en-IN");

function App() {
  const {
    graph,
    isLoading,
    error,
    loadGraph,
    selectedNode,
    selectedNodeId,
    isLoadingNode,
    nodeError,
    selectNode,
    closeSelectedNode,
    highlightedNodeIds,
    setHighlightedNodeIds,
  } = useGraph();

  const {
    sessionId,
    messages,
    isBootstrapping,
    isSending,
    error: chatError,
    sendMessage,
    startNewSession,
  } = useChat({
    onAnswer: (response) => {
      setHighlightedNodeIds(response.nodesReferenced);
    },
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="app-shell__glow app-shell__glow--one" aria-hidden="true" />
      <div className="app-shell__glow app-shell__glow--two" aria-hidden="true" />

      <header className="hero">
        <div className="hero__copy">
          <p className="hero__eyebrow">SAP Order-to-Cash Atlas</p>
          <h1>Trace the full business flow and interrogate it in plain language.</h1>
          <p className="hero__body">
            The graph shows the transactional chain. The chat panel turns the
            same database into a grounded query surface backed by SQL.
          </p>
        </div>

        <dl className="hero__metrics">
          <div className="hero__metric">
            <dt>Nodes</dt>
            <dd>{numberFormatter.format(graph.nodes.length)}</dd>
          </div>
          <div className="hero__metric">
            <dt>Edges</dt>
            <dd>{numberFormatter.format(graph.edges.length)}</dd>
          </div>
          <div className="hero__metric">
            <dt>Highlighted</dt>
            <dd>{numberFormatter.format(highlightedNodeIds.length)}</dd>
          </div>
        </dl>
      </header>

      <main id="main-content" className="workspace">
        <GraphPanel
          graph={graph}
          isLoading={isLoading}
          error={error}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          isLoadingNode={isLoadingNode}
          nodeError={nodeError}
          highlightedNodeIds={highlightedNodeIds}
          onNodeSelect={(node) => void selectNode(node)}
          onCloseNode={closeSelectedNode}
          onRetry={() => void loadGraph()}
          onClearHighlights={() => setHighlightedNodeIds([])}
        />

        <ChatPanel
          sessionId={sessionId}
          messages={messages}
          isBootstrapping={isBootstrapping}
          isSending={isSending}
          error={chatError}
          onSendMessage={sendMessage}
          onStartNewSession={async () => {
            setHighlightedNodeIds([]);
            closeSelectedNode();
            await startNewSession();
          }}
        />
      </main>
    </div>
  );
}

export default App;
