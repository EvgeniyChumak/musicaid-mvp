export type Level = {
  id: string
  number: string
  title: string
  eyebrow: string
  description: string
  skills: string[]
  visual: 'mint' | 'violet' | 'blue'
}

export type Song = {
  id: string
  levelId: Level['id']
  title: string
  composer: string
  duration: string
  measures: number
  tempo: number
  difficulty: string
  focus: string
  accent: string
  coverPath?: string
  midiPath?: string
  instrument: 'piano' | 'guitar'
  analysisMode: 'monophonic' | 'polyphonic'
  status?: 'ready' | 'preview'
}

export const levels: Level[] = [
  {
    id: 'foundations',
    number: '01',
    title: 'Beginner',
    eyebrow: 'Level 01',
    description: 'Read the keyboard, build steady pulse, and connect simple phrases.',
    skills: ['Posture', 'Note reading', 'Steady pulse'],
    visual: 'mint',
  },
  {
    id: 'expression',
    number: '02',
    title: 'Intermediate',
    eyebrow: 'Level 02',
    description: 'Shape phrases, coordinate both hands, and play with confident timing.',
    skills: ['Two hands', 'Dynamics', 'Rhythm control'],
    visual: 'violet',
  },
  {
    id: 'performance',
    number: '03',
    title: 'Advanced',
    eyebrow: 'Level 03',
    description: 'Refine interpretation, voicing, and the details that make a performance yours.',
    skills: ['Voicing', 'Rubato', 'Interpretation'],
    visual: 'blue',
  },
]

export const songs: Song[] = [
  {
    id: 'jingle-bells',
    levelId: 'foundations',
    title: 'Jingle Bells — beginner excerpt',
    composer: 'James Lord Pierpont',
    duration: '00:16',
    measures: 8,
    tempo: 120,
    difficulty: 'Beginner lesson',
    focus: 'Steady pulse & repeated notes',
    accent: '#167b67',
    coverPath: '/images/jingle-bells-cover.png',
    midiPath: '/midi/jingle-bells-beginner.mid',
    instrument: 'piano',
    analysisMode: 'monophonic',
    status: 'ready',
  },
  {
    id: 'titanic-theme',
    levelId: 'expression',
    title: 'My Heart Will Go On — easy two-hand excerpt',
    composer: 'James Horner · simplified demo arrangement',
    duration: '00:38',
    measures: 16,
    tempo: 100,
    difficulty: 'Intermediate preview',
    focus: 'Two-hand coordination & chord timing',
    accent: '#7867d9',
    midiPath: '/midi/titanic-theme-easy.mid',
    instrument: 'piano',
    analysisMode: 'polyphonic',
    status: 'preview',
  },
  {
    id: 'californication-guitar',
    levelId: 'expression',
    title: 'Californication — guitar arpeggio excerpt',
    composer: 'Red Hot Chili Peppers · simplified demo arrangement',
    duration: '00:20',
    measures: 8,
    tempo: 96,
    difficulty: 'Intermediate preview',
    focus: 'Arpeggio timing & ringing strings',
    accent: '#d47443',
    midiPath: '/midi/californication-guitar-easy.mid',
    instrument: 'guitar',
    analysisMode: 'polyphonic',
    status: 'preview',
  },
]
