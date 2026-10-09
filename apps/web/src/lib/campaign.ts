export type Channel = "LinkedIn" | "X" | "Instagram";

export type ContentItem = {
  id: number;
  day: number;
  date: string;
  channel: Channel;
  theme: string;
  status: "Ready" | "Changes requested";
  body: string;
};

export const contentItems: ContentItem[] = [
  {
    id: 1,
    day: 1,
    date: "Oct 12",
    channel: "LinkedIn",
    theme: "A clearer way to write at work",
    status: "Ready",
    body: "Clear writing is a professional advantage.\n\nScribe helps you rewrite messages without leaving the app you are using. Turn a rough thought into a clear update in seconds.\n\nWrite with confidence. Anywhere you work.\n\n#Productivity #BetterCommunication",
  },
  {
    id: 2,
    day: 2,
    date: "Oct 13",
    channel: "LinkedIn",
    theme: "Turn ideas into clear messages",
    status: "Ready",
    body: "Good ideas deserve clear words.\n\nScribe helps you turn thoughts into polished, professional messages faster and with less friction. Whether it is a quick reply or a complex update, you can sound like you, only clearer.\n\nWrite with confidence. Anywhere you work.\n\n#Productivity #BetterCommunication",
  },
  {
    id: 3,
    day: 3,
    date: "Oct 14",
    channel: "X",
    theme: "Write with confidence, anywhere",
    status: "Ready",
    body: "Your next work message can be clearer before you press send. Scribe rewrites it where you already type.",
  },
  {
    id: 4,
    day: 4,
    date: "Oct 15",
    channel: "LinkedIn",
    theme: "Real time, real impact",
    status: "Ready",
    body: "Clear writing matters most when the message matters. Scribe works inside your keyboard, so clarity is always one tap away.",
  },
  {
    id: 5,
    day: 5,
    date: "Oct 16",
    channel: "Instagram",
    theme: "From messy to meaningful",
    status: "Ready",
    body: "Messy first draft? Keep it. Scribe can help you turn it into a message you are ready to send.",
  },
  {
    id: 6,
    day: 6,
    date: "Oct 17",
    channel: "X",
    theme: "Your thoughts, better wording",
    status: "Ready",
    body: "Keep your meaning. Improve the wording. Scribe helps your messages sound clear without losing your voice.",
  },
  {
    id: 7,
    day: 7,
    date: "Oct 18",
    channel: "LinkedIn",
    theme: "Small changes, bigger progress",
    status: "Ready",
    body: "One clearer message will not change your career. A habit of clear communication might. Start with the next thing you send.",
  },
];
