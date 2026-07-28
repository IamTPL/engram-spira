/* @refresh reload */
import 'solid-devtools';
import { render } from 'solid-js/web';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './app.css';
// Initialize theme (applies dark/light class to <html> on load)
import './stores/theme.store';
import App from './app';

const root = document.getElementById('root');

if (!root) throw new Error('Root element not found');

// Remove the inline loading shell before Solid mounts —
// render() appends to the container, it does not replace innerHTML.
const shell = document.getElementById('app-loading-shell');
if (shell) shell.remove();

render(() => <App />, root);
