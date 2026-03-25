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
    sessions,
    messages,
    isBootstrapping,
    isSending,
    error: chatError,
    sendMessage,
    startNewSession,
    selectSession,
  } = useChat({
    onMeta: (meta) => {
      setHighlightedNodeIds(meta.nodesReferenced);
    },
    onAnswer: (response) => {
      setHighlightedNodeIds(response.nodesReferenced);
    },
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="topbar">
        <div className="topbar__breadcrumbs">
          <span>Mapping</span>
          <span>/</span>
          <strong>Order to Cash</strong>
        </div>

        <div className="topbar__stats" aria-label="Application summary">
          <span>{numberFormatter.format(graph.nodes.length)} nodes</span>
          <span>{numberFormatter.format(graph.edges.length)} edges</span>
          <span>{numberFormatter.format(highlightedNodeIds.length)} highlighted</span>
        </div>
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
          sessions={sessions}
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
          onSelectSession={async (nextSessionId) => {
            setHighlightedNodeIds([]);
            closeSelectedNode();
            await selectSession(nextSessionId);
          }}
        />
      </main>
    </div>
  );
}

export default App;
