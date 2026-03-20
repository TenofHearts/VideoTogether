/*
Copyright Jin Ye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#47334f',
        paper: '#f4ebbf',
        coral: '#a63c12',
        gold: '#925111',
        meadow: '#67da86',
        lilac: '#5616b5'
      },
      boxShadow: {
        panel: '0 18px 42px rgba(151, 123, 125, 0.14)'
      }
    }
  },
  plugins: []
} satisfies Config;
