import { DocsLayout } from "./components/DocsLayout";
import { useLocation } from "./lib/router";

export function App() {
  const { route, hash } = useLocation();
  return <DocsLayout route={route} hash={hash} />;
}

export default App;
