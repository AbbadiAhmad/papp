import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import catalogEn from '../../locales/en.json';

vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));

import { ImageLightbox } from '../../frontend/ImageLightbox';

const images = [1, 2, 3].map((n) => ({ url: `/full-${n}.jpg`, alt: `pic ${n}` }));

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});

describe('ImageLightbox', () => {
  it('shows nothing while closed', () => {
    render(<ImageLightbox images={images} index={null} onClose={() => undefined} />);
    expect(screen.queryByTestId('lightbox-image')).toBeNull();
  });

  it('opens on the chosen picture at full size and walks next / previous, wrapping around', () => {
    render(<ImageLightbox images={images} index={1} onClose={() => undefined} />);
    expect(screen.getByTestId('lightbox-image').getAttribute('src')).toBe('/full-2.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(screen.getByTestId('lightbox-image').getAttribute('src')).toBe('/full-3.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(screen.getByTestId('lightbox-image').getAttribute('src')).toBe('/full-1.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    expect(screen.getByTestId('lightbox-image').getAttribute('src')).toBe('/full-3.jpg');
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<ImageLightbox images={images} index={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
