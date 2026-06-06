export class BasePage {
  constructor(containerElement) {
    this.container = containerElement; // The dedicated DOM div for page content
  }

  async mount() {
    // 1. Inject HTML into this.container
    // 2. Attach local event listeners
    // 3. Trigger CSS fade-in
  }

  async unmount() {
    // 1. Trigger CSS fade-out
    // 2. Remove event listeners (crucial for memory)
    // 3. Clear this.container.innerHTML
  }

  getSpriteConfig() {
    // Return the LayoutController (SpriteWrite, SpriteImage, etc.)
    // that the heroPool needs to morph into for this specific page.
    return null; 
  }
}