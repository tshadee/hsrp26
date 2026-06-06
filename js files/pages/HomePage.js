import { SpriteWrite , SpriteImage } from '../main.js';

export class HomePage {
  constructor(container, heroPool) {
    this.container = container;
    this.heroPool = heroPool;
    this.intervalId = null;
    
    this.texts = [
        'hsrp26',
        'hsrp.cc',
        '0123456789\n!@#$%^&*() -_=+[]{}|;:,.<>?/~`',
        'the quick brown fox\njumps over the lazy dog',
        'THE QUICK BROWN FOX\nJUMPS OVER THE LAZY DOG',
        'x'
    ];
    this.index = 0;
    
    // Instantiate the layout controller once
    this.spriteController = new SpriteWrite(this.texts[0], 14).attach(this.heroPool);
    this.spriteImage = new SpriteImage("hsrp-logo", 300).attach(this.heroPool);
  }

  async mount() {
    // 1. Failsafe HTML injection (empty for now, but ready if needed)
    this.container.innerHTML = `<div class="page-home"></div>`;
    
    // 2. Start the unique sprite looping logic for this page
    this.intervalId = setInterval(() => {
        if (this.index == 5) {
            this.heroPool.mutateTo(this.spriteImage);
        } else {
            this.spriteController.morphTo(this.texts[this.index]);
        }
      this.index = (this.index + 1) % this.texts.length;
    }, 3000);
  }

  async unmount() {
    // 1. Clean up DOM
    this.container.innerHTML = '';
    
    // 2. Kill the loop so it doesn't bleed into other pages
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getSpriteConfig() {
    // Provide the current state so the Router knows what to morph to immediately
    if(this.index == 5){ return this.spriteImage; };
    this.spriteController.config.text = this.texts[this.index];
    return this.spriteController;
  }
}