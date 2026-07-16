import { randomInt } from 'node:crypto';

// Reserve the upper half of the Kitty image ID space for short-lived native
// capability probes. Application images stay in the lower half.
const MAX_APPLICATION_IMAGE_ID = 0x7fffffff;

export type ImageId = number & { readonly __imageId: unique symbol };

export class ImageIdRegistry {
  readonly #active = new Set<ImageId>();
  readonly #generate: () => number;

  constructor(generate: () => number = () => randomInt(1, MAX_APPLICATION_IMAGE_ID + 1)) {
    this.#generate = generate;
  }

  allocate(): ImageId {
    if (this.#active.size >= MAX_APPLICATION_IMAGE_ID) {
      throw new Error('Kitty graphics image ID space exhausted');
    }

    let id: ImageId;
    do {
      const candidate = this.#generate();
      if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_APPLICATION_IMAGE_ID) {
        throw new RangeError(`Invalid Kitty graphics image ID: ${candidate}`);
      }
      id = candidate as ImageId;
    } while (this.#active.has(id));

    this.#active.add(id);
    return id;
  }

  release(id: ImageId) {
    return this.#active.delete(id);
  }

  activeIds() {
    return [...this.#active];
  }
}
