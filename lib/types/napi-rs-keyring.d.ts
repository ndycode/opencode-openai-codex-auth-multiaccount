declare module "@napi-rs/keyring" {
	export class Entry {
		constructor(service: string, username: string);
		getPassword(): string | null;
		setPassword(secret: string): void;
		deletePassword(): boolean;
	}
}
