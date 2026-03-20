declare module 'cytoscape-dagre' {
  import type { Core } from 'cytoscape';
  const register: (cy: typeof import('cytoscape')) => void;
  export default register;
}
