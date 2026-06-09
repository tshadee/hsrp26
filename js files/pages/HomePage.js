import { SpriteWrite, SpriteImage, SpriteGroup } from '../main.js';

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
    
    this.spriteController = new SpriteWrite(this.texts[0], 14)
    .setAnchor(50,75)
    .setJustify('center')
    .setAlign('center');
    this.spriteImage = new SpriteImage("hsrp-logo", 300, 1.0, true);
    this.pageTextController = new SpriteWrite("home", 9, 0.8)
      .setAnchor(50, 95)
      .setJustify('center')
      .setAlign('top');

    this.spriteGroup = new SpriteGroup().attach(heroPool);
    this.spriteGroup.add(this.spriteController, container);
    this.spriteGroup.add(this.spriteImage, container);
    this.spriteGroup.add(this.pageTextController, container);
    this.spriteGroup.setChildActive(this.spriteImage, true);
  }

  async mount() {
    this.container.innerHTML = `<div class="page-home"></div>`; 
    
    this.intervalId = setInterval(() => {
      if (this.index === 5) {
          this.spriteGroup.setChildActive(this.spriteController, false);
      } else {
          this.spriteGroup.setChildActive(this.spriteController, true);
          
          // Update the underlying text config
          this.spriteController.config.text = this.texts[this.index];
      }

      // Tell the pool to re-evaluate the entire group
      this.heroPool.mutateTo(this.spriteGroup);

      this.index = (++this.index) % this.texts.length;
    }, 3000);
  }

  async unmount() {
    this.container.innerHTML = '';
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getSpriteConfig() {
    // For immediate routing handoffs
    if (this.index === 5) { 
      this.spriteGroup.setChildActive(this.spriteController, false);
    } else {
      this.spriteGroup.setChildActive(this.spriteController, true);
      this.spriteController.text = this.texts[this.index];
    }
    
    this.index = (this.index + 1) % this.texts.length;
    return this.spriteGroup; 
  }
}