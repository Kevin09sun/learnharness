import { nativePathPickerResponse } from "@/src/server";

/** Opens the OS file/folder dialog on this machine and returns chosen paths. */
export async function POST(request: Request) {
	return nativePathPickerResponse(request);
}
