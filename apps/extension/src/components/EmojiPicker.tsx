import { useMemo, useRef, useState } from 'react';
import {
  EMOJI_CATEGORIES,
  SHAPE_CATEGORIES,
  paletteCategories,
  searchPalette,
  type PaletteKind,
} from './emoji-palette';
import './EmojiPicker.scss';

interface EmojiPickerProps {
  /** Called with the chosen character. */
  onSelect: (value: string) => void;
  /** Called when the picker should close. */
  onClose: () => void;
}

type PaletteTab = PaletteKind;

/**
 * A searchable emoji / shape picker.
 *
 * The picker is deliberately self-contained: it renders a category strip and
 * a grid, and hands the chosen character back to the caller, which owns the
 * insertion logic (so the caller can insert at the caret rather than
 * appending).
 */
export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [tab, setTab] = useState<PaletteTab>('emoji');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => paletteCategories(tab), [tab]);
  const results = useMemo(() => searchPalette(tab, query), [tab, query]);

  const isSearching = query.trim().length > 0;

  return (
    <div className="emoji-picker" role="dialog" aria-label="Insert emoji or shape">
      <div className="emoji-picker-header">
        <div className="emoji-picker-tabs">
          <button
            className={`emoji-picker-tab${tab === 'emoji' ? ' active' : ''}`}
            onClick={() => {
              setTab('emoji');
              setQuery('');
            }}
            title="Emoji"
          >
            😀 Emoji
          </button>
          <button
            className={`emoji-picker-tab${tab === 'shape' ? ' active' : ''}`}
            onClick={() => {
              setTab('shape');
              setQuery('');
            }}
            title="Shapes"
          >
            ◆ Shapes
          </button>
        </div>
        <input
          ref={searchRef}
          type="text"
          className="emoji-picker-search"
          placeholder={`Search ${tab === 'emoji' ? 'emoji' : 'shapes'}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <button className="emoji-picker-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {isSearching ? (
        <div className="emoji-picker-grid">
          {results.length === 0 && (
            <div className="emoji-picker-empty">No matches</div>
          )}
          {results.map((item, index) => (
            <button
              key={`${item}-${index}`}
              className="emoji-picker-cell"
              onClick={() => onSelect(item)}
              title={item}
            >
              {item}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="emoji-picker-categories">
            {categories.map((category) => (
              <button
                key={category.id}
                className="emoji-picker-category"
                title={category.label}
                onClick={() => {
                  const grid = document.getElementById(
                    `emoji-category-${category.id}`,
                  );
                  grid?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }}
              >
                {category.shortLabel ?? category.label.charAt(0)}
              </button>
            ))}
          </div>
          <div className="emoji-picker-scroll">
            {categories.map((category) => (
              <div
                key={category.id}
                id={`emoji-category-${category.id}`}
                className="emoji-picker-section"
              >
                <div className="emoji-picker-section-title">{category.label}</div>
                <div className="emoji-picker-grid">
                  {category.items.map((item, index) => (
                    <button
                      key={`${item}-${index}`}
                      className="emoji-picker-cell"
                      onClick={() => onSelect(item)}
                      title={item}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { EMOJI_CATEGORIES, SHAPE_CATEGORIES };
