import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Settings from '../settings/Settings';
import '../styles.scss';

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <Settings />
  </StrictMode>
);