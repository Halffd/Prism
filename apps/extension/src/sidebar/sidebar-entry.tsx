import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '@prism/redux-store';
import { AuthProvider } from '../auth-provider';
import { ChatPage } from '../chat/ChatPage';

/**
 * The Chrome side panel.
 *
 * The toolbar action opens this page instead of a popup that disappears as
 * soon as the user clicks the page. It reuses the chat page so the panel
 * carries the same tabs, search and session navigation as the full tab.
 */
const container = document.getElementById('sidebarApp');
if (!container) {
  throw new Error('Could not find sidebarApp container');
}

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <Provider store={store}>
        <ChatPage />
      </Provider>
    </AuthProvider>
  </StrictMode>,
);
