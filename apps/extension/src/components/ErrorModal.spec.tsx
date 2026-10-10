import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorModal, ErrorModalHost } from './ErrorModal';

describe('ErrorModal', () => {
  it('renders the missing chat history warning', () => {
    render(<ErrorModal onClose={() => {}} />);
    expect(screen.getByText('Missing chat history')).toBeTruthy();
    expect(
      screen.getByText('We could not load the conversation for this chat'),
    ).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn();
    render(<ErrorModal onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the warning dismiss button is clicked', () => {
    const onClose = jest.fn();
    render(<ErrorModal onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Dismiss warning'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorModalHost', () => {
  it('renders the modal into a shadow root', () => {
    const { container } = render(<ErrorModalHost onClose={() => {}} />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot?.textContent).toContain('Missing chat history');
  });
});
