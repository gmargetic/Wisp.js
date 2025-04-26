# Wisp.js

**Wisp.js** is a lightweight, extensible JavaScript class for building interactive, AJAX-driven, component-based UIs. It supports SPA-like navigation, SSR/partial hydration, polling, loading states, error handling, and custom event hooks.

---

## About

Wisp.js is your invisible assistant for reactive components – a featherlight JavaScript layer that brings your server-rendered UI to life with minimal effort. Whether you're building full SPAs or progressive enhancements, Wisp empowers you with declarative markup, real-time interactions, and powerful flexibility – without a giant framework in your way.

Wisp keeps your markup clean, your logic simple, and your app fast.

---

## ⚠️ **Warning**  
This project is still under active development. Expect bugs, unfinished features, and dragons. Use at your own risk!

---

## Features

- **Component-based AJAX**: Update only the relevant part of the DOM.
- **SPA Navigation**: Seamless page transitions with a configurable progress bar.
- **SSR/Partial Hydration**: Hydrate server-rendered components or specific DOM subtrees.
- **Polling**: Auto-refresh components at configurable intervals.
- **Flexible Loading States**: Show/hide, add/remove classes, attributes, or spinners during loading.
- **Error Handling**: Floating error alerts and optional remote error reporting.
- **Custom Events**: Listen for Wisp lifecycle and error events.
- **Configurable**: All behaviors can be customized via `Wisp.init()`.

---

## Installation

Include the script in your HTML:

```html
<script src="/path/to/Wisp.js"></script>
```

---

## Initialization

```javascript
Wisp.init({
    defaultDebounce: 250,                // Debounce for model updates (ms)
    quietDebounce: 500,                  // Debounce for "quiet" model updates (ms)
    errorDisplayTime: 8000,              // Error alert display time (ms)
    enablePerformanceLogging: true,      // Log AJAX/navigation timings
    navigationProgressBar: true,         // Enable SPA progress bar
    navigationProgressBarColor: '#29d',  // Progress bar color
    navigationProgressBarHeight: '3px',  // Progress bar height
    errorEndpoint: '/log-error'          // (Optional) POST errors to this endpoint
});
```

For SSR/partial hydration, set `window.__SSR_MODE__ = true;` before DOMContentLoaded and Wisp will hydrate existing components.

---

## Markup Reference

### Components

```html
<div wisp:component="counter" wisp:id="abc123" wisp:data='{"count": 5}' wisp:checksum="...">
    ...
</div>
```

- `wisp:component`: Component name (required)
- `wisp:id`: Unique component instance ID (required)
- `wisp:data`: JSON-encoded state (required)
- `wisp:checksum`: Integrity check value (required)

---

### Actions

#### Click

```html
<button wisp:click="increment">+</button>
```

#### Submit

```html
<form wisp:submit="save">
    ...
</form>
```

---

### Model Binding

```html
<input wisp:model="name">
<input wisp:model="email" wisp:model.quiet>
<input wisp:model="search" wisp:model.delay="1000">
```

- `wisp:model`: Binds input value to component state.
- `wisp:model.quiet`: Only updates after user stops typing.
- `wisp:model.delay`: Custom debounce in ms.

---

### Polling

```html
<div wisp:poll="2s" wisp:poll.if="visible"></div>
```

- `wisp:poll="2s"`: Poll every 2 seconds. Supports `ms` or `s` (e.g. `500ms`, `5s`).
- `wisp:poll.if="visible"`: Only poll if element is visible.
- `wisp:poll.if="data-foo"`: Only poll if element has attribute `foo`.

---

### SPA Navigation

```html
<a href="/about" wisp:navigate>About</a>
```

- Intercepts navigation and loads via AJAX, updating only the `#app` container if present.

---

### Loading States

Add these attributes to any element inside a component to control its appearance during AJAX requests:

| Attribute                       | Description                                                                 |
|----------------------------------|-----------------------------------------------------------------------------|
| `wisp:loading`               | Show element during loading, hide otherwise                                 |
| `wisp:loading.remove`        | Hide element during loading, show otherwise                                 |
| `wisp:loading.spinner`       | Show a spinner inside the element during loading                            |
| `wisp:loading.flex`          | Display as `flex` during loading                                            |
| `wisp:loading.inline-flex`   | Display as `inline-flex` during loading                                     |
| `wisp:loading.block`         | Display as `block` during loading                                           |
| `wisp:loading.grid`          | Display as `grid` during loading                                            |
| `wisp:loading.table`         | Display as `table` during loading                                           |
| `wisp:loading.class="..."`   | Add/remove classes during loading. Format: `"add btn-loading;remove btn"`   |
| `wisp:loading.attr="..."`    | Add/remove attributes during loading. Format: `"disabled,aria-busy=true"`   |
| `wisp:loading.target="..."`  | Only apply loading state for specific method(s)                             |
| `wisp:loading.target.except` | Exclude loading state for specific method(s)                                |

**Example:**

```html
<button wisp:click="save"
        wisp:loading.spinner
        wisp:loading.class="add btn-loading;remove btn"
        wisp:loading.attr="disabled">
    Save
</button>
<span wisp:loading>Loading...</span>
```

---

### Error Handling

- Errors are shown as floating alerts.
- Optionally, set `errorEndpoint` in config to POST errors to your server.

---

## Request Headers

```http
POST /current-url-path HTTP/1.1
Content-Type: application/json
Accept: application/json
X-Requested-With: X-Wisp
```

## Request Headers for Navigation

```http
GET /target-url HTTP/1.1
Accept: text/html
X-Requested-With: X-Wisp-Navigate
```

---


## JSON Body Structure

### Regular Method Call

```json
{
    "component": "component-name",
    "method": "method-name",
    "_token": "CSRF-token-value",
    "payload": {
        "componentId": "component-id",
        "checksum": "...",
        "...": "additionalPayloadData"
    }
}
```

### Model Update Call (__updateModel)

```json
{
    "component": "component-name",
    "method": "__updateModel",
    "_token": "CSRF-token-value",
    "payload": {
        "componentId": "component-id",
        "checksum": "...",
        "data": {
            "fieldName": "fieldValue",
            "...": "otherFields"
        }
    }
}
```

---

## Field Descriptions

| Field          | Type      | Description                               |
| -------------- | --------- | ----------------------------------------- |
| component      | string    | Name of the component making the call     |
| method         | string    | Method being called on the component      |
| _token         | string    | CSRF token from <meta name="csrf-token">  |
| payload        | object    | Contains the request data                 |
| componentId    | string    | Unique ID of the component instance       |
| checksum       | string    | Checksum for the component state          |
| data           | object    | (For model updates) Key-value fields      |


---

## Example Requests

### Regular Method Call

```json
{
    "component": "user-profile",
    "method": "updateAvatar",
    "_token": "...",
    "payload": {
        "componentId": "profile-1",
        "checksum": "...",
        "avatarUrl": "https://example.com/avatar.jpg"
    }
}
```

---

### Model Update

```json
{
    "component": "search-form",
    "method": "__updateModel",
    "_token": "...",
    "payload": {
        "componentId": "search-1",
        "checksum": "...",
        "data": {
            "query": "wisp framework",
            "filter": "recent"
        }
    }
}
```

---

### Form Submission

```json
{
    "component": "contact-form",
    "method": "submit",
    "_token": "...",
    "payload": {
        "componentId": "contact-1",
        "checksum": "...",
        "name": "John Doe",
        "email": "john@example.com",
        "message": "Hello Wisp!"
    }
}
```

---

## Server Response Format

Wisp expects the following JSON structure from the server:

```json
{
  "view": "<div wisp:component=\"counter\" ...>...</div>",
  "checksum": "...",
  "data": { "count": 6 },
  "error": false,
  "message": null
}
```

- `view`: The new HTML for the component (must include all `wisp:*` attributes).
- `checksum`: Used for integrity checks.
- `data`: (optional) New state for the component.
- `error`: (optional) Set to `true` if there was an error.
- `message`: (optional) Error message.

**On error:**

```json
{
  "error": true,
  "message": "Something went wrong"
}
```

---

## SSR/Partial Hydration

- Render your components server-side with all `wisp:*` attributes.
- On page load, call `Wisp.hydrate()` (automatically done if `window.__SSR_MODE__` is set).
- To hydrate a specific subtree after a partial update, use `Wisp.hydrateElement(rootElement)`.

---

## Custom Events

Listen for Wisp events:

```javascript
Wisp.on('update', e => { /* ... */ });
Wisp.on('hydrated', e => { /* ... */ });
Wisp.on('error', e => { /* ... */ });
```

Remove event listeners with:

```javascript
Wisp.off('update', handler);
```

---

## Advanced

- **Debounce Utilities**: Use `Wisp.debounce` and `Wisp.debounceQuiet` for your own handlers.
- **Performance Logging**: Enable `enablePerformanceLogging` in config for timing logs.
- **Cleanup**: Wisp automatically cleans up event listeners and timers on page unload.

---

## License

GNU GENERAL PUBLIC LICENSE Version 3
[LICENSE](LICENSE) 

---
