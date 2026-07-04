export type Tradition = 'iqaat' | 'african' | 'latin' | 'flamenco' | 'aksak' | 'electronic';

export interface RhythmPattern {
  id: string;
  name: string;
  tradition: Tradition;
  meter: string;      // display badge, e.g. "8/8", "10/8", "12/8", "4/4·16ths"
  steps: number;      // 1..16
  rate: 0 | 1;        // 0 = '1/8', 1 = '1/16' (matches the sequencer's rate select)
  rows: number[][];   // up to 4 rows (Doum/low, Tak/high, Ka/aux, Ghost); each length === steps; omit trailing empty rows
  note: string;       // one line of cultural context — part of the teaching mission
  status: 'verified' | 'draft';
  source?: string;
}

export const traditionLabels: Record<Tradition, string> = {
  iqaat: 'Arabic Iqa\u02bfat',
  african: 'West African 12/8',
  latin: 'Latin & Clave',
  flamenco: 'Flamenco Comp\u00e1s',
  aksak: 'Balkan & Turkish Aksak',
  electronic: 'Electronic',
};

export const patterns: RhythmPattern[] = [
  // Iqaat
  {
    id: 'maqsum', name: 'Maqsum', tradition: 'iqaat', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [1,0,0,0,1,0,0,0],
      [0,1,0,1,0,0,1,0]
    ],
    note: "The workhorse of Egyptian and Levantine music — if you learn one iqa\u02bf, it's this.",
    status: 'verified', source: 'MaqamWorld'
  },
  {
    id: 'baladi', name: 'Baladi', tradition: 'iqaat', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [1,1,0,0,1,0,0,0],
      [0,0,0,1,0,0,1,0]
    ],
    note: "Maqsum's earthier cousin — the doubled doum plants it in the ground.",
    status: 'draft'
  },
  {
    id: 'saidi', name: 'Saidi', tradition: 'iqaat', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [1,0,0,1,1,0,0,0],
      [0,1,0,0,0,0,1,0]
    ],
    note: "Upper Egypt's cane-dance rhythm — the two middle doums are the horse's step.",
    status: 'draft'
  },
  {
    id: 'malfuf', name: 'Malfuf', tradition: 'iqaat', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [1,0,0,0,0,0,0,0],
      [0,0,0,1,0,0,1,0]
    ],
    note: "A fast 2/4 that carries processions and entrances.",
    status: 'draft'
  },
  {
    id: 'samai', name: "Sama\u02bfi Thaqil", tradition: 'iqaat', meter: '10/8', steps: 10, rate: 0,
    rows: [
      [1,0,0,0,0,1,1,0,0,0],
      [0,0,0,1,0,0,0,1,0,0]
    ],
    note: "The classical 10/8 of the Ottoman-Arab art repertoire.",
    status: 'verified', source: 'MaqamWorld'
  },
  {
    id: 'wahda', name: 'Wahda', tradition: 'iqaat', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [1,0,0,0,0,0,0,0],
      [0,0,0,0,1,0,0,0]
    ],
    note: "'The one' — a single doum leaves the whole bar to the singer.",
    status: 'draft'
  },
  {
    id: 'ayyub', name: 'Ayyub', tradition: 'iqaat', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [1,0,0,0,1,0,0,0],
      [0,0,0,0,0,0,1,0],
      [0,0,0,1,0,0,0,0]
    ],
    note: "Hypnotic zar-trance pulse — lean into it at speed.",
    status: 'verified', source: 'G.D. Sawa; MaqamWorld'
  },
  {
    id: 'masmoudi_kabir', name: 'Masmoudi Kabir', tradition: 'iqaat', meter: '8/4', steps: 16, rate: 0,
    rows: [
      [1,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,1,0,0,0,0,0,1,0,1,0]
    ],
    note: "The 'big' masmoudi in eight slow beats — Baladi is its little sibling. (skeleton form — fills omitted).",
    status: 'draft'
  },
  {
    id: 'jurjuna', name: 'Jurjuna', tradition: 'iqaat', meter: '6/8', steps: 6, rate: 0,
    rows: [
      [1,0,0,1,0,0],
      [0,0,1,0,1,0]
    ],
    note: "Iraqi 6/8 lilt — beloved from Baghdad to the Gulf.",
    status: 'draft'
  },
  {
    id: 'dawr_hindi', name: 'Dawr Hindi', tradition: 'iqaat', meter: '7/8', steps: 7, rate: 0,
    rows: [
      [1,0,0,1,0,0,0],
      [0,0,1,0,0,1,0]
    ],
    note: "A seven that walks — the 'Indian cycle' of the Arab east.",
    status: 'draft'
  },

  // African
  {
    id: 'ewe_bell', name: 'Standard Bell (Ewe)', tradition: 'african', meter: '12/8', steps: 12, rate: 0,
    rows: [
      [],
      [1,0,1,0,1,1,0,1,0,1,0,1],
      [0,0,1,0,0,1,0,0,1,0,0,1]
    ],
    note: "The timeline that anchors Ewe drumming — seven strokes every drummer navigates by.",
    status: 'verified', source: 'Locke / Agawu (Ewe drumming literature)'
  },
  {
    id: 'bembe', name: '6/8 Clave (Bemb\u00e9)', tradition: 'african', meter: '12/8', steps: 12, rate: 0,
    rows: [
      [],
      [1,0,1,0,1,0,0,1,0,1,0,0]
    ],
    note: "The African-Cuban bridge — son clave's 12/8 ancestor.",
    status: 'verified', source: 'Locke / Agawu (Ewe drumming literature)'
  },

  // Latin
  {
    id: 'son_clave_3_2', name: 'Son Clave 3–2', tradition: 'latin', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [],
      [1,0,0,1,0,0,1,0,0,0,1,0,1,0,0,0]
    ],
    note: "Five strokes that organize everything played above them.",
    status: 'verified', source: 'Canonical (Afro-Cuban literature)'
  },
  {
    id: 'son_clave_2_3', name: 'Son Clave 2–3', tradition: 'latin', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [],
      [0,0,1,0,1,0,0,0,1,0,0,1,0,0,1,0]
    ],
    note: "Same five strokes, halves swapped — the question becomes the answer.",
    status: 'verified', source: 'Canonical (Afro-Cuban literature)'
  },
  {
    id: 'rumba_clave_3_2', name: 'Rumba Clave 3–2', tradition: 'latin', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [],
      [1,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0]
    ],
    note: "One sixteenth later on the third hit — and everything gets hotter.",
    status: 'verified', source: 'Canonical (Afro-Cuban literature)'
  },
  {
    id: 'tumbao_bass', name: 'Tumbao (bass)', tradition: 'latin', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0]
    ],
    note: "The bass avoids beat one — the space IS the groove.",
    status: 'verified', source: 'Canonical (Afro-Cuban literature)'
  },

  // Flamenco
  {
    id: 'solea', name: 'Sole\u00e1', tradition: 'flamenco', meter: '12', steps: 12, rate: 0,
    rows: [
      [],
      [0,0,1,0,0,1,0,1,0,1,0,1]
    ],
    note: "Count to twelve; the weight lives on 3, 6, 8, 10 and 12.",
    status: 'draft'
  },
  {
    id: 'buleria', name: 'Buler\u00eda', tradition: 'flamenco', meter: '12', steps: 12, rate: 0,
    rows: [
      [0,0,0,0,0,0,0,0,0,0,0,1],
      [0,0,1,0,0,1,0,1,0,1,0,1]
    ],
    note: "The sole\u00e1 skeleton at double speed — entered on twelve, resolved on ten.",
    status: 'draft'
  },
  {
    id: 'alegrias', name: 'Alegr\u00edas', tradition: 'flamenco', meter: '12', steps: 12, rate: 0,
    rows: [
      [],
      [0,0,1,0,0,1,0,1,0,1,0,1],
      [1,1,0,1,1,0,1,0,1,0,1,0]
    ],
    note: "The bright side of the twelve — C\u00e1diz in a bar.",
    status: 'draft'
  },
  {
    id: 'tangos', name: 'Tangos', tradition: 'flamenco', meter: '8/8', steps: 8, rate: 0,
    rows: [
      [],
      [0,0,1,0,1,0,1,0],
      [0,1,0,1,0,1,0,1]
    ],
    note: "Flamenco's 4/4 — beat one often breathes instead of hitting.",
    status: 'draft'
  },

  // Aksak
  {
    id: 'karsilama', name: 'Kar\u015f\u0131lama', tradition: 'aksak', meter: '9/8', steps: 9, rate: 0,
    rows: [
      [1,0,0,0,1,0,0,0,0],
      [0,0,1,0,0,0,1,1,0]
    ],
    note: "2+2+2+3 — the nine that dances across Turkey and the Balkans.",
    status: 'draft'
  },
  {
    id: 'kalamatianos', name: 'Kalamatian\u00f3s', tradition: 'aksak', meter: '7/8', steps: 7, rate: 0,
    rows: [
      [1,0,0,0,0,0,0],
      [0,0,0,1,0,1,0]
    ],
    note: "3+2+2 — Greece's national line dance leans on the long first group.",
    status: 'draft'
  },
  {
    id: 'rachenitsa', name: 'R\u01cechenitsa', tradition: 'aksak', meter: '7/8', steps: 7, rate: 0,
    rows: [
      [1,0,0,0,1,0,0],
      [0,0,1,0,0,1,0]
    ],
    note: "2+2+3 — Bulgaria's wedding seven; the limp is the point.",
    status: 'draft'
  },
  {
    id: 'kopanitsa', name: 'Kopanitsa', tradition: 'aksak', meter: '11/8', steps: 11, rate: 0,
    rows: [
      [1,0,0,0,1,0,0,0,0,1,0],
      [0,0,1,0,0,0,0,1,0,0,1]
    ],
    note: "2+2+3+2+2 — eleven that feels inevitable once your feet learn it.",
    status: 'draft'
  },

  // Electronic
  {
    id: 'four_on_floor', name: 'Four on the Floor', tradition: 'electronic', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0]
    ],
    note: "House music's heartbeat — kick every quarter, hats answering off the beat.",
    status: 'verified', source: 'Canonical (electronic production)'
  },
  {
    id: 'boom_bap', name: 'Boom Bap', tradition: 'electronic', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]
    ],
    note: "Hip-hop's swung skeleton — the kick talks around the backbeat.",
    status: 'draft'
  },
  {
    id: 'dembow', name: 'Dembow', tradition: 'electronic', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]
    ],
    note: "Tresillo under a backbeat — reggaeton's engine, Caribbean to the core.",
    status: 'verified', source: 'Canonical (electronic production)'
  },
  {
    id: 'trap', name: 'Trap', tradition: 'electronic', meter: '4/4·16ths', steps: 16, rate: 1,
    rows: [
      [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      [1,0,1,0,1,0,1,0,1,1,1,1,1,0,1,0]
    ],
    note: "Half-time: the snare waits for three while the hats do the talking.",
    status: 'draft'
  }
];
