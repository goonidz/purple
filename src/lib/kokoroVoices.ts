export interface KokoroVoice {
  id: string;
  label: string;
  gender: "female" | "male";
  grade: string;
}

export interface KokoroVoiceGroup {
  language: string;
  langCode: string;
  voices: KokoroVoice[];
}

export const KOKORO_VOICE_GROUPS: KokoroVoiceGroup[] = [
  {
    language: "American English",
    langCode: "a",
    voices: [
      { id: "af_bella", label: "Bella", gender: "female", grade: "A-" },
      { id: "af_nicole", label: "Nicole", gender: "female", grade: "B-" },
      { id: "af_aoede", label: "Aoede", gender: "female", grade: "C+" },
      { id: "af_kore", label: "Kore", gender: "female", grade: "C+" },
      { id: "af_sarah", label: "Sarah", gender: "female", grade: "C+" },
      { id: "af_alloy", label: "Alloy", gender: "female", grade: "C" },
      { id: "af_nova", label: "Nova", gender: "female", grade: "C" },
      { id: "af_sky", label: "Sky", gender: "female", grade: "C-" },
      { id: "af_jessica", label: "Jessica", gender: "female", grade: "D" },
      { id: "af_river", label: "River", gender: "female", grade: "D" },
      { id: "am_michael", label: "Michael", gender: "male", grade: "C+" },
      { id: "am_fenrir", label: "Fenrir", gender: "male", grade: "C+" },
      { id: "am_puck", label: "Puck", gender: "male", grade: "C+" },
      { id: "am_echo", label: "Echo", gender: "male", grade: "D" },
      { id: "am_eric", label: "Eric", gender: "male", grade: "D" },
      { id: "am_liam", label: "Liam", gender: "male", grade: "D" },
      { id: "am_onyx", label: "Onyx", gender: "male", grade: "D" },
      { id: "am_adam", label: "Adam", gender: "male", grade: "F+" },
    ],
  },
  {
    language: "British English",
    langCode: "b",
    voices: [
      { id: "bf_emma", label: "Emma", gender: "female", grade: "B-" },
      { id: "bf_isabella", label: "Isabella", gender: "female", grade: "C" },
      { id: "bf_alice", label: "Alice", gender: "female", grade: "D" },
      { id: "bf_lily", label: "Lily", gender: "female", grade: "D" },
      { id: "bm_fable", label: "Fable", gender: "male", grade: "C" },
      { id: "bm_george", label: "George", gender: "male", grade: "C" },
      { id: "bm_lewis", label: "Lewis", gender: "male", grade: "D+" },
      { id: "bm_daniel", label: "Daniel", gender: "male", grade: "D" },
    ],
  },
  {
    language: "French",
    langCode: "f",
    voices: [
      { id: "ff_siwis", label: "Siwis", gender: "female", grade: "B-" },
    ],
  },
  {
    language: "Hindi",
    langCode: "h",
    voices: [
      { id: "hf_alpha", label: "Alpha", gender: "female", grade: "C" },
      { id: "hf_beta", label: "Beta", gender: "female", grade: "C" },
      { id: "hm_omega", label: "Omega", gender: "male", grade: "C" },
      { id: "hm_psi", label: "Psi", gender: "male", grade: "C" },
    ],
  },
  {
    language: "Italian",
    langCode: "i",
    voices: [
      { id: "if_sara", label: "Sara", gender: "female", grade: "C" },
      { id: "im_nicola", label: "Nicola", gender: "male", grade: "C" },
    ],
  },
  {
    language: "Japanese",
    langCode: "j",
    voices: [
      { id: "jf_alpha", label: "Alpha", gender: "female", grade: "C+" },
      { id: "jf_gongitsune", label: "Gongitsune", gender: "female", grade: "C" },
      { id: "jf_tebukuro", label: "Tebukuro", gender: "female", grade: "C" },
      { id: "jf_nezumi", label: "Nezumi", gender: "female", grade: "C-" },
      { id: "jm_kumo", label: "Kumo", gender: "male", grade: "C-" },
    ],
  },
  {
    language: "Mandarin Chinese",
    langCode: "z",
    voices: [
      { id: "zf_xiaobei", label: "Xiaobei", gender: "female", grade: "D" },
      { id: "zf_xiaoni", label: "Xiaoni", gender: "female", grade: "D" },
      { id: "zf_xiaoxiao", label: "Xiaoxiao", gender: "female", grade: "D" },
      { id: "zf_xiaoyi", label: "Xiaoyi", gender: "female", grade: "D" },
      { id: "zm_yunjian", label: "Yunjian", gender: "male", grade: "D" },
      { id: "zm_yunxi", label: "Yunxi", gender: "male", grade: "D" },
      { id: "zm_yunxia", label: "Yunxia", gender: "male", grade: "D" },
      { id: "zm_yunyang", label: "Yunyang", gender: "male", grade: "D" },
    ],
  },
];

export const ALL_KOKORO_VOICES = KOKORO_VOICE_GROUPS.flatMap((g) => g.voices);

export const DEFAULT_KOKORO_VOICE = "af_bella";
