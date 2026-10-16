import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';
import { RichText } from '../../frontend/components/RichText';
import { RichTextField } from '../../frontend/components/RichTextField';

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

describe('RichText', () => {
  it('renders bold, italic, colour and safe links', () => {
    const { container } = render(<RichText text={'**b** *i* {red|r} [site](https://example.com)'} />);
    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
    expect((container.querySelector('span[style]') as HTMLElement).style.color).toBe('rgb(198, 40, 40)');
    const link = screen.getByRole('link', { name: 'site' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('never turns text into HTML', () => {
    const { container } = render(<RichText text={'<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders maths with KaTeX, and shows a formula KaTeX cannot read as typed', () => {
    const { container } = render(<RichText text={'Area is $\\pi r^2$ and $\\badmacro{$'} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelectorAll('.katex').length).toBe(1);
    expect(container.querySelector('code')?.textContent).toBe('\\badmacro{');
  });

  it('keeps maths from running scripts', () => {
    const { container } = render(<RichText text={'$\\href{javascript:alert(1)}{click}$'} />);
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('RichTextField toolbar', () => {
  function Harness() {
    const [value, setValue] = useState('hello world');
    return <RichTextField label="Text" value={value} onValueChange={setValue} />;
  }

  it('wraps the selected text and shows a preview', async () => {
    render(<Harness />);
    const box = screen.getByLabelText('Text') as HTMLInputElement;
    box.focus();
    box.setSelectionRange(6, 11);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(box.value).toBe('hello **world**');
    expect(await screen.findByText('world', { selector: 'strong' })).toBeInTheDocument();
  });

  it('offers the colour names and inserts the chosen one', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Text colour' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Green' }));
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toContain('{green|');
  });
});
