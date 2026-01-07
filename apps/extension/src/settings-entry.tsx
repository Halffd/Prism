import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '@prism/redux-store';
import { AuthProvider } from './auth-provider';
import Settings from './settings/Settings';
import './styles.scss';

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <AuthProvider>
      <Provider store={store}>
        <Settings />
      </Provider>
    </AuthProvider>
  </StrictMode>
);