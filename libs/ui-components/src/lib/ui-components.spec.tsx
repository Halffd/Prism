import { render } from '@testing-library/react';

import PrismUiComponents from './ui-components';

describe('PrismUiComponents', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<PrismUiComponents />);
    expect(baseElement).toBeTruthy();
  });
});
