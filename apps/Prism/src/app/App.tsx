import React, { useState } from 'react';
import { ChatScreen } from './screens/ChatScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const App = () => {
  const [currentScreen, setCurrentScreen] = useState<'chat' | 'settings'>('chat');

  const navigateToSettings = () => {
    setCurrentScreen('settings');
  };

  const navigateToChat = () => {
    setCurrentScreen('chat');
  };

  return currentScreen === 'chat' ?
    <ChatScreen navigateToSettings={navigateToSettings} /> :
    <SettingsScreen navigateToChat={navigateToChat} />;
};

export default App;
