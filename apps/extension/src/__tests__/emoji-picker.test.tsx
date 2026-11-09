import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPicker } from '../components/EmojiPicker';
import {
  EMOJI_CATEGORIES,
  SHAPE_CATEGORIES,
  searchPalette,
  paletteCategories,
  allPaletteItems,
} from '../components/emoji-palette';

describe('Emoji palette data', () => {
  test('provides emoji categories with items', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(0);

    for (const category of EMOJI_CATEGORIES) {
      expect(category.id).toBeTruthy();
      expect(category.label).toBeTruthy();
      expect(category.items.length).toBeGreaterThan(0);
    }
  });

  test('provides shape categories with items', () => {
    expect(SHAPE_CATEGORIES.length).toBeGreaterThan(0);

    for (const category of SHAPE_CATEGORIES) {
      expect(category.items.length).toBeGreaterThan(0);
    }
  });

  test('has no duplicate characters within a category', () => {
    for (const category of [...EMOJI_CATEGORIES, ...SHAPE_CATEGORIES]) {
      const unique = new Set(category.items);
      expect(unique.size).toBe(category.items.length);
    }
  });

  test('searches palette items by character', () => {
    const results = searchPalette('shape', '◆');
    expect(results).toContain('◆');
  });

  test('searches shape items by keyword', () => {
    const results = searchPalette('shape', 'lightning');
    expect(results).toContain('⚡');
  });

  test('returns every item for an empty query', () => {
    expect(searchPalette('emoji', '').length).toBe(allPaletteItems('emoji').length);
  });

  test('returns the categories for the requested kind', () => {
    expect(paletteCategories('emoji')).toBe(EMOJI_CATEGORIES);
    expect(paletteCategories('shape')).toBe(SHAPE_CATEGORIES);
  });
});

describe('EmojiPicker', () => {
  test('renders the emoji tab by default and reports the chosen character', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();

    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

    // The smiley category is the first one, so its characters are on screen.
    const button = screen.getByTitle('😀');
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledWith('😀');
  });

  test('switches to the shapes tab', () => {
    const onSelect = jest.fn();

    render(<EmojiPicker onSelect={onSelect} onClose={jest.fn()} />);

    fireEvent.click(screen.getByTitle('Shapes'));

    // The geometric category is the first one, so its characters are on
    // screen. The diamond appears once per category, so the first match is
    // the geometric one.
    const button = screen.getAllByTitle('◆')[0];
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledWith('◆');
  });

  test('filters the grid as the user searches', () => {
    render(<EmojiPicker onSelect={jest.fn()} onClose={jest.fn()} />);

    const search = screen.getByPlaceholderText('Search emoji…');
    fireEvent.change(search, { target: { value: '🚀' } });

    expect(screen.getByTitle('🚀')).toBeTruthy();
    expect(screen.queryByTitle('😀')).toBeNull();
  });

  test('reports no matches for an unknown search', () => {
    render(<EmojiPicker onSelect={jest.fn()} onClose={jest.fn()} />);

    const search = screen.getByPlaceholderText('Search emoji…');
    fireEvent.change(search, { target: { value: 'zzzzznotanemoji' } });

    expect(screen.getByText('No matches')).toBeTruthy();
  });

  test('closes when the close button is pressed', () => {
    const onClose = jest.fn();

    render(<EmojiPicker onSelect={jest.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByTitle('Close'));

    expect(onClose).toHaveBeenCalled();
  });
});
