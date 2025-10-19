// Kconfig-editor for VSCode
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export class Stack {
  private count: number = 0;
  private storage: { [key: number]: any } = {};

  push(value: any): void {
    this.storage[this.count] = value;
    this.count++;
  }

  pop(): any {
    // Check if the stack is empty
    if (this.count === 0) {
      return undefined;
    }

    this.count--;
    const result = this.storage[this.count];
    delete this.storage[this.count];
    return result;
  }

  size(): number {
    return this.count;
  }

  peek(): any {
    return this.storage[this.count - 1];
  }
}
