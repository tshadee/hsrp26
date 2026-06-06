export class Router {
  constructor(heroPool, uiGroup) {
    this.heroPool = heroPool;
    this.uiGroup = uiGroup; // Optional: To refresh UI positions or trigger explosions
    this.pages = [];
    this.currentIndex = -1;
    this.isTransitioning = false;
  }

  register(pageInstance) {
    this.pages.push(pageInstance);
    return this;
  }

  async navigateTo(index) {
    if (this.isTransitioning || index === this.currentIndex) return;
    this.isTransitioning = true;

    const currentPage = this.pages[this.currentIndex];
    const nextPage = this.pages[index];

    // Phase 1: DOM Out
    if (currentPage) await currentPage.unmount();

    // Phase 2: Sprite Morph
    const nextLayout = nextPage.getSpriteConfig();
    if (nextLayout) {
      // We don't await this perfectly because we want the DOM to fade in 
      // while the sprites are settling, not after they completely stop.
      this.heroPool.mutateTo(nextLayout); 
    }

    // Phase 3: DOM In
    // Give the sprites a small head start before injecting the HTML
    setTimeout(async () => {
      await nextPage.mount();
      this.currentIndex = index;
      this.isTransitioning = false;
    }, 400); 
  }

  async next() {
    const nextIdx = (this.currentIndex + 1) % this.pages.length;
    await this.navigateTo(nextIdx);
  }

  async prev() {
    const prevIdx = (this.currentIndex - 1 + this.pages.length) % this.pages.length;
    await this.navigateTo(prevIdx);
  }
}