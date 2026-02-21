// assistant.js
function createAssistantPanel() {
    const section = document.createElement("section");
    section.className = "assistant";
    section.setAttribute("aria-label", "AI Assistant");

    section.innerHTML = '
        <h2>NorthStar Assistant</h2>
        <div id="assistant-log" aria-live="polite"></div>
        <form id="assistant-form">
            <label for ="assistant-input">Ask for help</label>
            <input id="assistant-input" type="text" placeholder="Describe what you notice around you" />
            <div>
                <button type="submit">Send</button>
                <button type="button" id="assistant-camera-btn">Use Camera</button>
            </div>
        </form>
       ';

    return section;
}