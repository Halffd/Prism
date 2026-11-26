import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '@prism/redux-store';
import { ChatPage } from './ChatPage';

// The chat tab uses the same Redux store as the popup, so session tabs,
// saved transcripts and model settings stay in sync between them.
const container = document.getElementById('chatApp');
if (container) {
  const root = createRoot(container);
  root.render(
    <Provider store={store}>
      <ChatPage />
    </Provider>,
  );
} else {
  console.error('Could not find chatApp container');
}
