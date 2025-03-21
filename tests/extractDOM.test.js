import { describe, it, expect, beforeEach } from 'vitest';
import { extractDOM } from '../extractDOM';

describe('extractDOM', () => {
  let page;

  beforeEach(() => {
    // Setup a sample DOM structure
    document.body.innerHTML = `
      <div id="container">
        <p class="text">Hello world</p>
        <a href="#">Link</a>
        <span>Not interactive</span>
        <button>Click me</button>
      </div>
    `;

    // Create a fake "page" object that simulates page.evaluate
    page = {
      evaluate: async (fn, options) => fn(options)
    };
  });

  it('should extract all elements by default', async () => {
    const result = await extractDOM(page);
    // Check that the result is an array
    expect(Array.isArray(result)).toBe(true);
    // Our sample DOM should yield at least 5 elements:
    // body > div#container, and its children: p, a, span, button.
    expect(result.length).toBeGreaterThanOrEqual(5);

    // Each extracted element should have the expected properties.
    result.forEach(el => {
      expect(el).toHaveProperty('tag');
      expect(el).toHaveProperty('selector');
      expect(el).toHaveProperty('attributes');
      expect(el).toHaveProperty('textContent');
      expect(el).toHaveProperty('isInteractive');
    });
  });

  it('should only extract interactive elements when interactiveOnly is true', async () => {
    const options = { interactiveOnly: true };
    const result = await extractDOM(page, options);
    // In our sample, only the <a> and <button> are interactive.
    const interactiveTags = result.map(el => el.tag);
    expect(interactiveTags).toEqual(expect.arrayContaining(['a', 'button']));
    // Ensure non-interactive elements like div, p, and span are not included.
    expect(interactiveTags).not.toEqual(expect.arrayContaining(['div', 'p', 'span']));
  });

  it('should filter elements by includedTags', async () => {
    const options = { includedTags: ['p', 'a'] };
    const result = await extractDOM(page, options);
    // Only <p> and <a> should be included.
    result.forEach(el => {
      expect(['p', 'a']).toContain(el.tag);
    });
  });

  it('should filter out elements by excludedTags', async () => {
    const options = { excludedTags: ['div'] };
    const result = await extractDOM(page, options);
    // No element with tag "div" should be present.
    result.forEach(el => {
      expect(el.tag).not.toBe('div');
    });
  });

  it('should limit the number of extracted elements using maxElements', async () => {
    const options = { maxElements: 3 };
    const result = await extractDOM(page, options);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});
