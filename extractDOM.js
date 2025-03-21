// Function to extract DOM elements with filtering options
async function extractDOM(page, options = {}) {
    
    return page.evaluate((evalOptions) => {
      const { 
        interactiveOnly = false,
        maxDepth = Infinity,
        includeText = true,
        textMinLength = 0,
        textMaxLength = Infinity,
        includedTags = [],
        excludedTags = [],
        maxElements = Infinity
      } = evalOptions;
      
      function extractElements(root, path = '', depth = 0, elementsCount = { count: 0 }) {
        // Stop if we've reached max elements
        if (elementsCount.count >= maxElements) {
          return [];
        }
        
        // Stop recursion if we've reached max depth
        if (depth > maxDepth) {
          return [];
        }
        
        const elements = [];
        
        Array.from(root.children).forEach((element, index) => {
            // Stop if we've reached max elements
            if (elementsCount.count >= maxElements) {
                return;
            }

            if (typeof element.tagName !== 'string') {
                console.warn('Unexpected element without tagName:', element);
            }
            
            const tag = (typeof element.tagName === 'string') ? element.tagName.toLowerCase() : '';
            
            // Skip if tag is excluded or not included when includedTags is specified
            if (
                excludedTags.includes(tag) || 
                (includedTags.length > 0 && !includedTags.includes(tag))
            ) {
                return;
            }
            
            // Get attributes
            // const attributes = {};
            // Array.from(element.attributes).forEach(attr => {
            //     attributes[attr.name] = attr.value;
            // });

            // const id = element.id ? `#${element.id}` : '';
            // const elementPath = `${path} > ${tag}${id}${classes}:nth-child(${index + 1})`;
            const classes = Array.from(element.classList).map(c => `.${c}`).join('');
            const id = element.id ? `#${element.id}` : '';
            const attributes = Array.from(element.attributes)
            .filter(attr => !['id', 'class'].includes(attr.name))
            .map(attr => {
                // Escape quotes in attribute values to prevent selector breakage
                const escapedValue = attr.value.replace(/"/g, '\\"');
                return `[${attr.name}="${escapedValue}"]`;
            })
            .join('');
            const elementPath = `${tag}${id}${classes}${attributes}`;
          
            
            // Get text content if requested
            let textContent = null;
            if (includeText) {
                const text = element.textContent.trim();
                if (text.length >= textMinLength && text.length <= textMaxLength) {
                textContent = text;
                }
            }
            
            // Determine if element is interactive
            const isInteractive = element.tagName === 'A' || 
                                element.tagName === 'BUTTON' || 
                                element.tagName === 'INPUT' || 
                                element.tagName === 'SELECT' ||
                                element.tagName === 'TEXTAREA' ||
                                element.getAttribute('role') === 'button' ||
                                element.getAttribute('tabindex') === '0' ||
                                element.getAttribute('onClick') !== null;
            
            // Skip if we only want interactive elements and this isn't one
            if (interactiveOnly && !isInteractive) {
                // No need to add this element, but still process its children
            } 
            else if (!isInteractive && !textContent) {
                // Skip if non-interactive and no text content
            } else {
                // Create element data
                const elementData = {
                tag,
                selector: elementPath.trim(),
                attributes,
                textContent,
                isInteractive
                };
                
                elements.push(elementData);
                elementsCount.count++;
            }
            
            // Recursively process children
            const childElements = extractElements(element, elementPath, depth + 1, elementsCount);
            elements.push(...childElements);
        });
        
        return elements;
      }
      
      const counter = { count: 0 };
      return extractElements(document.body, 'body', 0, counter);
    }, options);
}

module.exports = {
    extractDOM,
};
