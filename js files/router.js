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

    // 1: DOM Out
    if (currentPage) await currentPage.unmount();

    // 2: Sprite Morph
    const nextLayout = nextPage.getSpriteConfig();
    if (nextLayout) {
      this.heroPool.mutateTo(nextLayout); 
    }

    // 3: DOM In
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