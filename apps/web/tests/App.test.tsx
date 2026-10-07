import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

/** Smoke test: the app shell renders and shows the brand heading from TopBar. */
describe('<App />', () => {
  it('renders without crashing', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Annur Apps' })).toBeInTheDocument();
  });
});
