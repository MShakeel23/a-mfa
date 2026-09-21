import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// NOTE: no <React.StrictMode> - its dev-mode double effect invocation fires
// the WebAuthn ceremony twice, and Chrome aborts the first with
// "authentication ceremony was sent an abort signal".
createRoot(document.getElementById('root')).render(<App />);
