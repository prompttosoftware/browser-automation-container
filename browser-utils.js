const extractSelectors = (element) => {
    // Extract various selectors for the element
    const selectors = [];

    // Try ID selector if available
    if (element.attributes.id) {
        selectors.push(`#${element.attributes.id}`);
    }

    // Try data-testid if available
    if (element.attributes['data-testid']) {
        selectors.push(`[data-testid="${element.attributes['data-testid']}"]`);
    }

    // Try name attribute if available
    if (element.attributes.name) {
        selectors.push(`[name="${element.attributes.name}"]`);
    }

    // Try class combinations if available
    if (element.attributes.class) {
        const classes = element.attributes.class.split(' ').filter(c => c.trim().length > 0);
        if (classes.length > 0) {
        selectors.push(`.${classes.join('.')}`);
        }
    }

    // Try tag with text if available
    if (element.textContent && element.textContent.length < 100) {
        selectors.push(`${element.tag}:contains("${element.textContent}")`);
    }

    // Add the full path selector as a fallback
    selectors.push(element.selector);

    return selectors;
    };

    const getRecommendedActions = (elements) => {
    // Suggest possible actions based on the identified elements
    const suggestedActions = [];

    // Find login forms
    const usernameInputs = elements.filter(el => 
        (el.tag === 'input' && 
        (el.attributes.id?.includes('user') || 
        el.attributes.name?.includes('user') || 
        el.attributes.id?.includes('email') || 
        el.attributes.name?.includes('email')))
    );

    const passwordInputs = elements.filter(el => 
        (el.tag === 'input' && 
        (el.attributes.type === 'password' || 
        el.attributes.id?.includes('pass') || 
        el.attributes.name?.includes('pass')))
    );

    if (usernameInputs.length > 0 && passwordInputs.length > 0) {
        suggestedActions.push({
        description: 'Login form detected',
        actions: [
            { type: 'type', selector: extractSelectors(usernameInputs[0])[0], value: 'username' },
            { type: 'type', selector: extractSelectors(passwordInputs[0])[0], value: 'password' },
            // Look for a submit button
            { type: 'click', selector: 'button[type="submit"]' }
        ]
        });
    }

    // Find search forms
    const searchInputs = elements.filter(el => 
        (el.tag === 'input' && 
        (el.attributes.type === 'search' || 
        el.attributes.id?.includes('search') || 
        el.attributes.name?.includes('search') ||
        el.attributes.placeholder?.includes('search')))
    );

    if (searchInputs.length > 0) {
        suggestedActions.push({
        description: 'Search form detected',
        actions: [
            { type: 'type', selector: extractSelectors(searchInputs[0])[0], value: 'search query' },
            // Suggest pressing Enter
            { type: 'press', key: 'Enter' }
        ]
        });
    }

    // Find main navigation links
    const navLinks = elements.filter(el => 
        (el.tag === 'a' && 
        (el.attributes.role === 'menuitem' || 
        el.parentElement?.tag === 'nav'))
    );

    if (navLinks.length > 0) {
        suggestedActions.push({
        description: 'Main navigation links detected',
        actions: navLinks.slice(0, 5).map(link => ({
            type: 'click', 
            selector: extractSelectors(link)[0],
            description: `Navigate to ${link.textContent || link.attributes.href}`
        }))
        });
    }

    return suggestedActions;
};

module.exports = {
    extractSelectors,
    getRecommendedActions
};
