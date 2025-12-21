import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';

export function renderFloatingPopup(container: HTMLElement) {
  const root = ReactDOM.createRoot(container);
  root.render(<Popup />);
}