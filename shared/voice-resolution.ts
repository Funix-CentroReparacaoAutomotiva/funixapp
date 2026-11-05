export interface VoiceResolutionOption {id:string;label:string}
export interface VoiceResolutionQuestion {id:string;label:string;options:VoiceResolutionOption[]}
export interface VoiceResolution {id:string;questions:VoiceResolutionQuestion[]}
