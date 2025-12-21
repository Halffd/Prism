import React from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneChatPage } from './StandaloneChatPage';

// Create the root container for the React app
const container = document.getElementById('chatApp');
if (container) {
  const root = createRoot(container);
  root.render(<StandaloneChatPage />);
} else {
  console.error('Could not find chatApp container');
}