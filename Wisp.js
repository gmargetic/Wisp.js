/**
 * Wisp.js - A JavaScript framework for component-based interactions and AJAX requests
 *
 * @class Wisp
 * @description A reactive component system that handles DOM updates, data binding,
 * loading states, and navigation with minimal configuration.
 *
 * @property {Object} config - Configuration settings for Wisp
 * @property {number} config.defaultDebounce - Default debounce time in ms for input events (300)
 * @property {number} config.quietDebounce - Debounce time for quiet model updates (500)
 * @property {number} config.errorDisplayTime - Duration to show error messages (5000ms)
 * @property {boolean} config.enablePerformanceLogging - Flag to enable performance logging
 * @property {number} config.transitionDuration - Duration for UI transitions (200ms)
 *
 * @property {Map} timers - Stores polling timers
 * @property {Map} pendingRequests - Tracks in-flight AJAX requests
 * @property {MutationObserver|null} observer - DOM mutation observer instance
 * @property {boolean} observerInit - Flag indicating if observer is initialized
 */
class Wisp {
    static config = {
        defaultDebounce: 300,
        quietDebounce: 500,
        errorDisplayTime: 5000,
        enablePerformanceLogging: false,
        transitionDuration: 200
    };

    static timers = new Map();
    static pendingRequests = new Map();
    static observer = null;
    static observerInit = false;

    /**
     * Initializes Wisp with user configuration
     * @static
     * @param {Object} [userConfig={}] - User configuration overrides
     */
    static init(userConfig = {}) {
        Wisp.initErrorHandling();
        this.config = { ...this.config, ...userConfig };
        this.bind();
        this.setupObserver();
        this.setupNavigationListener()
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    /**
     * Makes a component method call with optional payload
     * @static
     * @async
     * @param {string} component - Component name
     * @param {string} method - Method to call
     * @param {Object} [payload={}] - Data to send
     * @param {HTMLElement|null} [triggerElement=null] - Element that triggered the call
     * @returns {Promise<Object>} Response data from server
     * @throws {Error} If component or method is missing
     */
    static async call(component, method, payload = {}, triggerElement = null) {
        if (!component || !method) {
            this.throwWispError('Component and method parameters are required', true);
        }

        const requestKey = `${component}:${method}:${JSON.stringify(payload)}`;

        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }

        try {
            const promise = this._executeCall(component, method, payload, triggerElement);
            this.pendingRequests.set(requestKey, promise);
            const result = await promise;
            return result;
        } finally {
            this.pendingRequests.delete(requestKey);
        }
    }

    /**
     * Executes the actual component call
     * @private
     * @static
     * @async
     * @param {string} component - Component name
     * @param {string} method - Method to call
     * @param {Object} [payload={}] - Data to send
     * @param {HTMLElement|null} [triggerElement=null] - Triggering element
     * @returns {Promise<Object>} Response data
     */
    static async _executeCall(component, method, payload = {}, triggerElement = null) {
        try {
            const startTime = performance.now();

            const componentEl = triggerElement?.closest(`[wisp\\:component="${component}"]`);
            const componentId = componentEl?.getAttribute('wisp:id');
            const checksum = componentEl?.getAttribute('wisp:checksum');
            const componentData = componentEl ? JSON.parse(componentEl.getAttribute('wisp:data') || '{}') : {};

            if (triggerElement) {
                this.setLoadingState(triggerElement, method, true, payload);
            }

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

            const requestPayload = method === '__updateModel' ? {
                component,
                method,
                _token: csrfToken,
                payload: {
                    componentId,
                    checksum,
                    data: payload
                }
            } : {
                component,
                method,
                _token: csrfToken,
                payload: {
                    ...payload,
                    componentId,
                    checksum
                }
            };

            const response = await fetch(window.location.href, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Requested-With': 'X-Wisp'
                },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                this.throwWispError(`HTTP error! status: ${response.status}`, true);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || (!contentType.includes('application/json') && !contentType.includes('json'))) {
                this.throwWispError('Server response was not JSON', true);
            }

            const responseData = await response.json();

            if (responseData.error) {
                this.throwWispError(responseData.message || 'Unknown error occurred', true);
            }

            if (!responseData.view || typeof responseData.checksum === 'undefined') {
                this.throwWispError('Invalid response format from server', true);
            }

            if (componentEl && responseData.view) {
                this.preserveActiveElement(() => {
                    componentEl.outerHTML = responseData.view;

                    const updatedComponentEl = document.querySelector(`[wisp\\:component="${component}"][wisp\\:id="${componentId}"]`);
                    if (updatedComponentEl) {
                        const newData = responseData.data || {};
                        this.dispatchUpdate(component, newData);
                    }
                });
            }

            if (this.config.enablePerformanceLogging) {
                const duration = performance.now() - startTime;
                console.debug(`Wisp call ${component}.${method} took ${duration.toFixed(2)}ms`);
            }

            this.bind();

            return responseData;
        } catch (error) {
            if (error instanceof TypeError && error.message.includes('fetch')) {
                this.throwWispError('Network error occurred. Please check your connection.');
            } else {
                this.throwWispError(error.message);
            }

            console.error('Wisp error:', error);
            document.dispatchEvent(new CustomEvent('wisp:error', {
                detail: { error, component, method }
            }));

            throw error;
        } finally {
            if (triggerElement) {
                this.setLoadingState(triggerElement, method, false, payload);
            }
        }
    }

    /**
     * Preserves focus state during DOM updates
     * @static
     * @param {Function} callback - Function that modifies DOM
     */
    static preserveActiveElement(callback) {
        const activeElement = document.activeElement;
        if (!activeElement) {
            callback();
            return;
        }

        const components = document.querySelectorAll('[wisp\\:component]');
        components.forEach(comp => {
            comp.style.transition = `opacity ${this.config.transitionDuration}ms ease`;
            comp.style.opacity = '0.5';
        });

        const state = {
            tagName: activeElement.tagName.toLowerCase(),
            type: activeElement.type,
            model: activeElement.getAttribute('wisp:model'),
            value: activeElement.value,
            selectionStart: activeElement.selectionStart,
            selectionEnd: activeElement.selectionEnd,
            componentId: activeElement.closest('[wisp\\:component]')?.getAttribute('wisp:id')
        };

        callback();

        requestAnimationFrame(() => {
            components.forEach(comp => {
                comp.style.opacity = '1';
                setTimeout(() => {
                    comp.style.transition = '';
                    comp.style.opacity = '';
                }, this.config.transitionDuration);
            });

            const strategies = [
                () => state.model && state.componentId ?
                    document.querySelector(`[wisp\\:component][wisp\\:id="${state.componentId}"] [wisp\\:model="${state.model}"]`) : null,
                () => state.componentId ?
                    document.querySelector(`[wisp\\:component][wisp\\:id="${state.componentId}"] ${state.tagName}[type="${state.type}"]`) : null,
                () => document.querySelector(`${state.tagName}[type="${state.type}"]`)
            ];

            let newElement = null;
            for (const strategy of strategies) {
                newElement = strategy();
                if (newElement) break;
            }

            if (newElement) {
                const tryFocus = () => {
                    if (newElement.disabled) {
                        requestAnimationFrame(tryFocus);
                    } else {
                        newElement.focus();
                        if (typeof state.value === 'string' && newElement.value !== state.value) {
                            newElement.value = state.value;
                        }
                        if (
                            typeof state.selectionStart === 'number' &&
                            typeof state.selectionEnd === 'number' &&
                            typeof newElement.setSelectionRange === 'function'
                        ) {
                            newElement.setSelectionRange(state.selectionStart, state.selectionEnd);
                        }
                    }
                };
                tryFocus();
            }
        });
    }

    /**
     * Displays an error message
     * @static
     * @param {string} message - Error message to display
     */
    static showError(message) {
        console.error('Wisp error:', message);

        document.querySelectorAll('.wisp-error').forEach(el => el.remove());

        const errorDiv = document.createElement('div');
        errorDiv.className = 'wisp-error';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 9999;
            max-width: 400px;
            word-break: break-word;
        `;
        errorDiv.textContent = message;
        errorDiv.setAttribute('role', 'alert');
        errorDiv.setAttribute('aria-live', 'assertive');

        document.body.appendChild(errorDiv);

        setTimeout(() => {
            errorDiv.style.opacity = '0';
            errorDiv.style.transition = 'opacity 0.3s ease';
            setTimeout(() => errorDiv.remove(), 300);
        }, this.config.errorDisplayTime);
    }

    /**
     * Initializes global error handling for Wisp errors
     * @static
     * @description
     * Sets up a global error handler that catches WispError instances.
     * Non-fatal Wisp errors will be displayed but won't stop execution.
     * Other errors will be passed to the original error handler if it exists.
     */
    static initErrorHandling() {
        const originalErrorHandler = window.onerror;

        window.onerror = (message, source, lineno, colno, error) => {
            if (error instanceof WispError) {
                this.showError(error.message);
                if (error.nonFatal) {
                    return true; // Prevent default error logging for non-fatal errors
                }
                return true; // Also prevent for fatal Wisp errors (though they'll stop execution)
            }

            if (originalErrorHandler) {
                return originalErrorHandler(message, source, lineno, colno, error);
            }
            return false; // Let default error handling occur
        };
    }

    /**
     * Throws a Wisp error with optional execution control
     * @static
     * @param {string} message - Error message to display
     * @param {boolean} [fatal=false] - Whether the error should stop execution
     * @throws {WispError} When fatal is true
     * @description
     * For fatal errors: throws immediately, stopping execution.
     * For non-fatal errors: shows the error but continues execution by throwing
     * in the next event loop tick.
     */
    static throwWispError(message, fatal = false) {
        const error = new WispError(message);
        error.nonFatal = !fatal;

        if (fatal) {
            throw error;
        } else {
            setTimeout(() => { throw error; }, 0);
            this.showError(message);
        }
    }


    /**
     * Asynchronously throws a Wisp error
     * @static
     * @async
     * @param {string} message - Error message to display
     * @param {boolean} [fatal=false] - Whether the error should stop execution
     * @throws {WispError} When fatal is true
     * @description
     * Shows the error immediately. Only throws if fatal is true.
     * Designed for use in async functions where you want to display
     * the error but might not want to stop execution.
     */
    static async throwWispErrorAsync(message, fatal = false) {
        this.showError(message);
        if (fatal) {
            throw new WispError(message);
        }
    }

    /**
     * Sets loading state for elements
     * @static
     * @param {HTMLElement} triggerEl - Element that triggered loading
     * @param {string} method - Method being called
     * @param {boolean} isLoading - Loading state
     * @param {Object} params - Call parameters
     */
    static setLoadingState(triggerEl, method, isLoading, params) {
        if (!triggerEl) return;

        const componentEl = triggerEl.closest('[wisp\\:component]');
        if (!componentEl) return;

        const actionId = params ? `${method}(${JSON.stringify(params)})` : method;

        const loadingElements = componentEl.querySelectorAll(`
            [wisp\\:loading],
            [wisp\\:loading\\.class],
            [wisp\\:loading\\.attr],
            [wisp\\:loading\\.remove],
            [wisp\\:loading\\.flex],
            [wisp\\:loading\\.inline-flex],
            [wisp\\:loading\\.block],
            [wisp\\:loading\\.grid],
            [wisp\\:loading\\.table],
            [wisp\\:loading\\.spinner]
        `);

        loadingElements.forEach(el => {
            const target = el.getAttribute('wisp:loading.target');
            if (target && !this.matchesTarget(target, actionId, method)) {
                return;
            }

            const exceptTarget = el.getAttribute('wisp:loading.target.except');
            if (exceptTarget && this.matchesTarget(exceptTarget, actionId, method)) {
                return;
            }

            this.applyLoadingState(el, isLoading);
        });
    }

    /**
     * Applies loading state to individual element
     * @static
     * @param {HTMLElement} el - Element to modify
     * @param {boolean} isLoading - Loading state
     */
   static applyLoadingState(el, isLoading) {
        if (!el._loadingState) {
            el._loadingState = {
                display: el.style.display,
                classes: [...el.classList],
                attributes: {},
                wasFocused: document.activeElement === el || el._pendingFocus,
                selectionStart: el.selectionStart,
                selectionEnd: el.selectionEnd
            };
        }

        el.setAttribute('aria-busy', isLoading);

        if (el.hasAttribute('wisp:loading.spinner')) {
            if (isLoading) {
                const spinner = document.createElement('div');
                spinner.className = 'wisp-spinner';
                spinner.innerHTML = `
                    <svg viewBox="0 0 50 50">
                        <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5"></circle>
                    </svg>
                `;
                el._loadingSpinner = spinner;
                el.appendChild(spinner);
            } else if (el._loadingSpinner) {
                el._loadingSpinner.remove();
                delete el._loadingSpinner;
            }
        }

        if (el.hasAttribute('wisp:loading') && !el.hasAttribute('wisp:loading.remove')) {
            const displayType = this.getDisplayType(el);
            el.style.display = isLoading ? displayType : 'none';
        }

        if (el.hasAttribute('wisp:loading.remove')) {
            el.style.display = isLoading ? 'none' : '';
        }

        const classModifier = el.getAttribute('wisp:loading.class');
        if (classModifier) {
            const types = classModifier.split(';');
            types.forEach((type) => {
                const [action, ...classes] = type.trim().split(' ');
                const classList = classes.join(' ');
                el.classList.toggle(classList, action === 'remove' ? !isLoading : isLoading);
            });
        }

        const attrModifier = el.getAttribute('wisp:loading.attr');
        if (attrModifier) {
            attrModifier.split(',').forEach(pair => {
                const [key, value] = pair.split('=').map(s => s.trim());
                if (key) {
                    if (isLoading) {
                        el._loadingState.attributes[key] = el.hasAttribute(key);
                        el.setAttribute(key, value || '');
                    } else {
                        el.removeAttribute(key);

                        if (el._loadingState.attributes[key]) {
                            setTimeout(() => {
                                el.setAttribute(key, '');
                            }, 0);
                        }
                    }
                }
            });
        }

        if (!isLoading && el._loadingState.wasFocused) {
            setTimeout(() => {
                if (el.disabled) {
                    requestAnimationFrame(() => {
                        if (!el.disabled) {
                            el.focus();
                            if (
                                typeof el._loadingState.selectionStart === 'number' &&
                                typeof el._loadingState.selectionEnd === 'number' &&
                                'setSelectionRange' in el
                            ) {
                                el.setSelectionRange(el._loadingState.selectionStart, el._loadingState.selectionEnd);
                            }
                        }
                        delete el._pendingFocus;
                        delete el._selectionStart;
                        delete el._selectionEnd;
                    });
                } else {
                    el.focus();
                    if (
                        typeof el._loadingState.selectionStart === 'number' &&
                        typeof el._loadingState.selectionEnd === 'number' &&
                        'setSelectionRange' in el
                    ) {
                        el.setSelectionRange(el._loadingState.selectionStart, el._loadingState.selectionEnd);
                    }
                    delete el._pendingFocus;
                    delete el._selectionStart;
                    delete el._selectionEnd;
                }
            }, 0);
        }

        if (!isLoading) {
            setTimeout(() => {
                el.removeAttribute('aria-busy');
                delete el._loadingState;
            }, 150);
        }
    }

    /**
     * Initializes loading states for elements
     * @static
     */
    static initLoadingStates() {
        document.querySelectorAll('[wisp\\:loading]:not([wisp\\:loading\\.remove])').forEach(el => {
            el.style.display = 'none';
        });
    }

    /**
     * Gets display type for loading state
     * @static
     * @param {HTMLElement} el - Element to check
     * @returns {string} CSS display value
     */
   static getDisplayType(el) {
        if (el.hasAttribute('wisp:loading.flex')) return 'flex';
        if (el.hasAttribute('wisp:loading.inline-flex')) return 'inline-flex';
        if (el.hasAttribute('wisp:loading.block')) return 'block';
        if (el.hasAttribute('wisp:loading.grid')) return 'grid';
        if (el.hasAttribute('wisp:loading.table')) return 'table';
        return 'inline-block';
    }

    /**
     * Checks if target matches action
     * @static
     * @param {string} target - Target pattern
     * @param {string} actionId - Full action ID
     * @param {string} method - Method name
     * @returns {boolean} True if matches
     */
    static matchesTarget(target, actionId, method) {
        return target.split(',').map(t => t.trim()).some(t => {
            if (t === actionId || t === method) return true;
            if (t.includes('(') && t.startsWith(method)) {
                const targetParams = t.match(/\((.*)\)/)?.[1];
                const actionParams = actionId.match(/\((.*)\)/)?.[1];
                return targetParams === actionParams;
            }
            return false;
        });
    }

    /**
     * Sets up navigation listener
     * @static
     */
    static setupNavigationListener() {
        window.addEventListener('popstate', () => {
            this.navigate(window.location.pathname + window.location.search, { pushState: false });
        });
    }

    /**
     * Binds all Wisp event handlers
     * @static
     */
    static bind() {
        document.querySelectorAll('[wisp\\:click]').forEach(el => {
            const method = el.getAttribute('wisp:click');
            const component = this.closestComponent(el);
            if (component) {
                el.removeEventListener('click', this.handleClick);
                el.addEventListener('click', this.handleClick);
            }
        });

        document.querySelectorAll('[wisp\\:submit]').forEach(el => {
            const method = el.getAttribute('wisp:submit');
            const component = this.closestComponent(el);
            if (component) {
                el.removeEventListener('submit', this.handleSubmit);
                el.addEventListener('submit', this.handleSubmit);
            }
        });

        this.bindPolling();
        this.initLoadingStates();
        this.bindModelBindings();
        this.bindNavigation();
    }


    /**
     * Sets up MutationObserver for dynamic content
     * @static
     */
    static setupObserver() {
        if (this.observer) return;

        this.observer = new MutationObserver(mutations => {
            if (!mutations.some(m => m.addedNodes.length > 0)) return;
            this.bind();
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Binds model data to form elements
     * @static
     */
    static bindModelBindings() {
        document.querySelectorAll('[wisp\\:model]').forEach(el => {
            const component = this.closestComponent(el);
            const modelName = el.getAttribute('wisp:model');

            if (!component || !modelName) return;

            const quietMode = el.hasAttribute('wisp:model.quiet');
            const delay = el.getAttribute('wisp:model.delay') ||
                         el.getAttribute('wisp:delay') ||
                         (quietMode ? this.config.quietDebounce :
                          el.type === 'text' || el.type === 'textarea' ? this.config.defaultDebounce : 0);

            const componentEl = el.closest('[wisp\\:component]');
            if (!componentEl) return;

            const componentData = JSON.parse(componentEl.getAttribute('wisp:data') || '{}');

            if (el.type === 'checkbox') {
                el.checked = !!componentData[modelName];
            } else if (el.type === 'radio') {
                el.checked = componentData[modelName] === el.value;
            } else {
                el.value = componentData[modelName] ?? '';
            }

            const updateValue = () => {
                const value = el.type === 'checkbox' ? el.checked : el.value;
                this.call(component, '__updateModel', { [modelName]: value }, el);
            };

            el.removeEventListener('input', el._wispInputHandler);
            el.removeEventListener('change', el._wispChangeHandler);
            el.removeEventListener('blur', el._wispBlurHandler);

            if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio') {
                el._wispChangeHandler = updateValue;
                el.addEventListener('change', el._wispChangeHandler);
            } else {
                if (quietMode) {
                    el._wispInputHandler = this.debounceQuiet(updateValue, parseInt(delay));
                } else {
                    el._wispInputHandler = this.debounce(updateValue, parseInt(delay));
                }

                el.addEventListener('input', el._wispInputHandler);

                if (!quietMode) {
                    el._wispBlurHandler = updateValue;
                    el.addEventListener('blur', el._wispBlurHandler);
                }
            }
        });
    }

    /**
     * Binds navigation handlers
     * @static
     */
    static bindNavigation() {
        document.querySelectorAll('a[wisp\\:navigate], a[wisp-navigate]').forEach(link => {
            link.removeEventListener('click', this.handleNavigate);
            link.addEventListener('click', this.handleNavigate);
        });
    }

    /**
     * Handles navigation link clicks
     * @static
     * @param {Event} e - Click event
     */
    static handleNavigate = (e) => {
        e.preventDefault();
        const url = e.currentTarget.getAttribute('href');
        if (!url || url === '#') return;

        this.navigate(url);
    };

    /**
     * Navigates to URL with AJAX
     * @static
     * @async
     * @param {string} url - URL to navigate to
     * @param {Object} [options={pushState: true}] - Navigation options
     */
    static async navigate(url, options = { pushState: true }) {
        try {
            const startTime = performance.now();

            this.showNavigationProgressBar();

            const response = await fetch(url, {
                headers: {
                    'X-Requested-With': 'X-Wisp-Navigate',
                    'Accept': 'text/html'
                }
            });

            if (!response.ok) {
                this.showError(`Navigation failed: ${response.status}`);
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Replace only #app if it exists
            const newApp = doc.querySelector('#app');
            const currentApp = document.querySelector('#app');
            if (newApp && currentApp) {
                currentApp.innerHTML = newApp.innerHTML;
            } else {
                document.body.innerHTML = doc.body.innerHTML;
            }

            document.title = doc.title;

            if (this.config.enablePerformanceLogging) {
                const duration = performance.now() - startTime;
                console.debug(`Wisp navigate took ${duration.toFixed(2)}ms`);
            }

            this.bind();
            this.bindNavigation();

            window.scrollTo(0, 0);
            if (options.pushState !== false) {
                window.history.pushState({}, '', url);
            }
        } catch (err) {
            this.showError(err.message);
            window.location.href = url; // fallback
        }
        finally {
            this.hideNavigationProgressBar();
        }
    }

    /**
     * Shows navigation progress bar
     * @static
     */
    static showNavigationProgressBar() {
        if (!this.config.navigationProgressBar) return;
        this.injectNavigationProgressBar();
        const bar = document.getElementById('wisp-progress-bar');
        if (!bar) return;
        bar.style.opacity = '1';
        bar.style.width = '0';
        setTimeout(() => { bar.style.width = '80%'; }, 10);
    }

    /**
     * Hides navigation progress bar
     * @static
     */
    static hideNavigationProgressBar() {
        if (!this.config.navigationProgressBar) return;
        const bar = document.getElementById('wisp-progress-bar');
        if (!bar) return;
        bar.style.width = '100%';
        setTimeout(() => {
            bar.style.opacity = '0';
            bar.style.width = '0';
        }, 400);
    }

    /**
     * Injects progress bar into DOM
     * @static
     */
    static injectNavigationProgressBar() {
        if (document.getElementById('wisp-progress-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'wisp-progress-bar';
        const color = this.config.navigationProgressBarColor || '#29d';
        const height = this.config.navigationProgressBarHeight || '3px';
        bar.style.cssText = `
            position:fixed;top:0;left:0;height:${height};width:0;
            background:${color};z-index:99999;transition:width 0.2s,opacity 0.4s;
            opacity:0;
        `;
        document.body.appendChild(bar);
    }

    /**
     * Debounces function execution
     * @static
     * @param {Function} fn - Function to debounce
     * @param {number} [delay=config.defaultDebounce] - Debounce delay
     * @returns {Function} Debounced function
     */
    static debounce(fn, delay = this.config.defaultDebounce) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), delay);
        };
    }

    /**
     * Debounces with quiet period
     * @static
     * @param {Function} fn - Function to debounce
     * @param {number} [quietPeriod=config.quietDebounce] - Quiet period
     * @returns {Function} Debounced function
     */
    static debounceQuiet(fn, quietPeriod = this.config.quietDebounce) {
        let timeoutId;
        let lastKeystroke = 0;

        return (...args) => {
            const now = Date.now();
            lastKeystroke = now;

            clearTimeout(timeoutId);

            timeoutId = setTimeout(() => {
                if (now === lastKeystroke) {
                    fn(...args);
                }
            }, quietPeriod);
        };
    }

    /**
     * Dispatches component update event
     * @static
     * @param {string} component - Component name
     * @param {Object} data - Updated data
     */
    static dispatchUpdate(component, data) {
        document.dispatchEvent(new CustomEvent('wisp:update', {
            detail: { component, data }
        }));
    }

    /**
     * Handles click events
     * @static
     * @param {Event} e - Click event
     */
    static handleClick = (e) => {
        e.preventDefault();
        const method = e.currentTarget.getAttribute('wisp:click');
        const component = this.closestComponent(e.currentTarget);
        if (component) this.call(component, method, {}, e.currentTarget);
    };

    /**
     * Handles form submissions
     * @static
     * @param {Event} e - Submit event
     */
    static handleSubmit = (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const method = form.getAttribute('wisp:submit');
        const component = this.closestComponent(form);
        if (component) {
            const formData = new FormData(form);
            this.call(component, method, Object.fromEntries(formData.entries()), form);
        }
    };


    /**
     * Finds closest component name
     * @static
     * @param {HTMLElement} el - Starting element
     * @returns {string|null} Component name or null
     */
    static closestComponent(el) {
        const componentEl = el.closest('[wisp\\:component]');
        return componentEl?.getAttribute('wisp:component') || null;
    }

    /**
     * Binds polling handlers
     * @static
     */
    static bindPolling() {
        this.timers.forEach((timer, component) => {
            clearInterval(timer);
            this.timers.delete(component);
        });

        document.querySelectorAll('[wisp\\:poll]').forEach(el => {
            const timeSpec = el.getAttribute('wisp:poll');
            const component = this.closestComponent(el);
            const method = el.getAttribute('wisp:target') || el.getAttribute('wisp:click') || 'poll';

            if (!component) return;

            if (el.hasAttribute('wisp:poll.if')) {
                const condition = el.getAttribute('wisp:poll.if');
                if (!this.evaluateCondition(condition, el)) {
                    return;
                }
            }

            const timeMatch = timeSpec.match(/(\d+)(s|ms)/);
            if (!timeMatch) return;

            const value = parseInt(timeMatch[1]);
            const unit = timeMatch[2];
            const interval = unit === 's' ? value * 1000 : value;

            this.timers.set(component, setInterval(() => {
                this.call(component, method, {}, el);
            }, interval));
        });
    }

    /**
     * Evaluates polling condition
     * @static
     * @param {string} condition - Condition to evaluate
     * @param {HTMLElement} element - Element to check
     * @returns {boolean} True if condition met
     */
    static evaluateCondition(condition, element) {
        if (condition === 'visible') {
            return element.offsetParent !== null;
        }

        if (condition.startsWith('data-')) {
            const attr = condition.replace('data-', '');
            return element.hasAttribute(attr);
        }

        return true;
    }

    /**
     * Cleans up Wisp resources
     * @static
     */
    static cleanup() {
        this.timers.forEach(timer => clearInterval(timer));
        this.timers.clear();

        document.querySelectorAll('[wisp\\:click], [wisp\\:submit]').forEach(el => {
            el.removeEventListener('click', this.handleClick);
            el.removeEventListener('submit', this.handleSubmit);
        });

        document.querySelectorAll('[wisp\\:model]').forEach(el => {
            el.removeEventListener('input', el._wispInputHandler);
            el.removeEventListener('change', el._wispChangeHandler);
            el.removeEventListener('blur', el._wispBlurHandler);
        });

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.pendingRequests.clear();
    }
}

/**
 * Custom error class for Wisp-related errors
 */
class WispError extends Error {
    /**
     * Create a WispError instance
     * @param {string} message - Error message
     */
    constructor(message) {
        super(message);
        this.name = "WispError";
    }
}

// Initialize Wisp when DOM is ready
document.addEventListener('DOMContentLoaded', () =>
    Wisp.init({
        defaultDebounce: 250,
        errorDisplayTime: 8000,
        enablePerformanceLogging: true,
        stopExecutionOnError: true,
        navigationProgressBar: true,
        navigationProgressBarColor: '#29d',
        navigationProgressBarHeight: '3px'
    })
);

// Expose to global scope if needed
window.Wisp = Wisp;
