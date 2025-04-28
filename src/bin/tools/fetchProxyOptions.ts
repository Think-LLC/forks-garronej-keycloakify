import child_process from "child_process";
import fs from "fs";
import path from "path";

export type FetchOptionsLike = {
    proxy: string | undefined;
    noProxy: string | string[];
    strictSSL: boolean;
    cert: string | string[] | undefined;
    ca: string[] | undefined;
};

// Config cache
const configCache = new Map<string, string | undefined>();

function findUpSync(filenames: string[], cwd: string): string | undefined {
    let current = path.resolve(cwd);
    while (true) {
        for (const filename of filenames) {
            if (fs.existsSync(path.join(current, filename))) {
                return current;
            }
        }

        const parent = path.dirname(current);

        if (parent === current) {
            // reached filesystem root
            return undefined;
        }

        current = parent;
    }
}

function detectYarn(cwd: string): boolean {
    const yarnRoot = findUpSync([".yarnrc.yml", ".yarn", ".pnp.cjs"], cwd);
    return yarnRoot !== undefined;
}

export function getProxyFetchOptions(params: {
    npmConfigGetCwd: string;
}): FetchOptionsLike {
    const { npmConfigGetCwd } = params;

    // Detect Yarn once
    const isYarn = detectYarn(npmConfigGetCwd);

    /**
     * Reads the npm/yarn config for a given key.
     * @param key The config key to read.
     * @returns The value of the config key, or undefined if not found.
     */
    function readConfig(key: string): string | undefined {
        if (configCache.has(key)) {
            return configCache.get(key);
        }

        try {
            const command = isYarn ? `yarn config get ${key}` : `npm config get ${key}`;

            let value: string | undefined = child_process
                .execSync(command, { cwd: npmConfigGetCwd })
                .toString("utf8")
                .trim();

            if (isYarn) {
                value = value.replace(/^"(.*)"$/, "$1"); // remove surrounding quotes for Yarn
            }

            if (value === "undefined" || value === "null") {
                value = undefined;
            }

            configCache.set(key, value);
            return value;
        } catch {
            configCache.set(key, undefined);
            return undefined;
        }
    }

    const proxy = readConfig("https-proxy") || readConfig("proxy");

    const noProxy = (readConfig("noproxy") || readConfig("no-proxy"))?.split(",") || [];

    const strictSSL = readConfig("strict-ssl") === "true";

    const cert = readConfig("cert");

    const ca = (() => {
        const caValue = readConfig("ca");
        const caArray = caValue ? [caValue] : [];
        return caArray;
    })();

    const cafile = readConfig("cafile");

    if (cafile !== undefined) {
        try {
            const cafileContent = fs.readFileSync(cafile).toString("utf8");

            const newLinePlaceholder = "NEW_LINE_PLACEHOLDER_xIsPsK23svt";

            const chunks = <T>(arr: T[], size: number = 2) =>
                arr
                    .map((_, i) => i % size == 0 && arr.slice(i, i + size))
                    .filter(Boolean) as T[][];

            ca.push(
                ...chunks(cafileContent.split(/(-----END CERTIFICATE-----)/), 2).map(
                    caChunk =>
                        caChunk
                            .join("")
                            .replace(/\r?\n/g, newLinePlaceholder)
                            .replace(new RegExp(`^${newLinePlaceholder}`), "")
                            .replace(new RegExp(newLinePlaceholder, "g"), "\\n")
                )
            );
        } catch (err) {
            // Ignore errors
        }
    }

    return { proxy, noProxy, strictSSL, cert, ca: ca.length === 0 ? undefined : ca };
}
