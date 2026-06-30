//#region \0%23tanstack-start-server-fn-resolver
var manifest = {
	"9f0b7d8c14dbe0b4b239e41c0f124d57127f5e2ebc7d6c7ae8afb695afae8967": {
		functionName: "analyzeCarImage_createServerFn_handler",
		importer: () => import("./vision-8Z8fQxxn.js")
	},
	"bca51df22d8a6c730017c7cb2bde4f7305bbdd712ae27a692c6015c21629e22c": {
		functionName: "sendVerificationEmail_createServerFn_handler",
		importer: () => import("./email-DgD7wILZ.js")
	}
};
async function getServerFnById(id, access) {
	const serverFnInfo = manifest[id];
	if (!serverFnInfo) throw new Error("Server function info not found for " + id);
	const fnModule = serverFnInfo.module ?? await serverFnInfo.importer();
	if (!fnModule) throw new Error("Server function module not resolved for " + id);
	const action = fnModule[serverFnInfo.functionName];
	if (!action) throw new Error("Server function module export not resolved for serverFn ID: " + id);
	return action;
}
//#endregion
export { getServerFnById as t };
