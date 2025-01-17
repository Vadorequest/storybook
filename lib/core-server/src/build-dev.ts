import { logger, instance as npmLog } from '@storybook/node-logger';
import {
  CLIOptions,
  LoadOptions,
  BuilderOptions,
  resolvePathInStorybookCache,
  loadAllPresets,
  Options,
} from '@storybook/core-common';
import dedent from 'ts-dedent';
import prompts from 'prompts';

import path from 'path';
import { storybookDevServer } from './dev-server';
import { getDevCli } from './cli';
import { getReleaseNotesData, getReleaseNotesFailedState } from './utils/release-notes';
import { outputStats } from './utils/output-stats';
import { outputStartupInformation } from './utils/output-startup-information';
import { updateCheck } from './utils/update-check';
import { cache } from './utils/cache';
import { getServerPort } from './utils/server-address';
import { getPreviewBuilder } from './utils/get-preview-builder';

export async function buildDevStandalone(options: CLIOptions & LoadOptions & BuilderOptions) {
  const { packageJson, versionUpdates, releaseNotes } = options;
  const { version } = packageJson;

  // updateInfo and releaseNotesData are cached, so this is typically pretty fast
  const [port, versionCheck, releaseNotesData] = await Promise.all([
    getServerPort(options.port),
    versionUpdates
      ? updateCheck(version)
      : Promise.resolve({ success: false, data: {}, time: Date.now() }),
    releaseNotes
      ? getReleaseNotesData(version, cache)
      : Promise.resolve(getReleaseNotesFailedState(version)),
  ]);

  if (!options.ci && !options.smokeTest && options.port != null && port !== options.port) {
    const { shouldChangePort } = await prompts({
      type: 'confirm',
      initial: true,
      name: 'shouldChangePort',
      message: `Port ${options.port} is not available. Would you like to run Storybook on port ${port} instead?`,
    });
    if (!shouldChangePort) process.exit(1);
  }

  /* eslint-disable no-param-reassign */
  options.port = port;
  options.versionCheck = versionCheck;
  options.releaseNotesData = releaseNotesData;
  options.configType = 'DEVELOPMENT';
  options.configDir = path.resolve(options.configDir);
  options.outputDir = options.smokeTest
    ? resolvePathInStorybookCache('public')
    : path.resolve(options.outputDir || resolvePathInStorybookCache('public'));
  /* eslint-enable no-param-reassign */

  const previewBuilder = await getPreviewBuilder(options.configDir);

  const presets = loadAllPresets({
    corePresets: [
      require.resolve('./presets/common-preset'),
      require.resolve('./presets/manager-preset'),
      ...previewBuilder.corePresets,
      require.resolve('./presets/babel-cache-preset'),
    ],
    overridePresets: previewBuilder.overridePresets,
    ...options,
  });

  const fullOptions: Options = {
    ...options,
    presets,
  };

  const { address, networkAddress, managerResult, previewResult } = await storybookDevServer(
    fullOptions
  );

  // @ts-ignore
  const previewTotalTime = previewResult?.totalTime;
  // @ts-ignore
  const managerTotalTime = managerResult?.totalTime;

  if (options.smokeTest) {
    // @ts-ignore
    const previewStats = previewResult?.stats;
    // @ts-ignore
    const managerStats = managerResult?.stats;

    await outputStats(previewStats, managerStats);
    const hasManagerWarnings = managerStats && managerStats.toJson().warnings.length > 0;
    const hasPreviewWarnings = previewStats && previewStats.toJson().warnings.length > 0;
    process.exit(hasManagerWarnings || (hasPreviewWarnings && !options.ignorePreview) ? 1 : 0);
    return;
  }

  outputStartupInformation({
    updateInfo: versionCheck,
    version,
    address,
    networkAddress,
    managerTotalTime,
    previewTotalTime,
  });
}

export async function buildDev(loadOptions: LoadOptions) {
  const cliOptions = await getDevCli(loadOptions.packageJson);

  try {
    await buildDevStandalone({
      ...cliOptions,
      ...loadOptions,
      configDir: loadOptions.configDir || cliOptions.configDir || './.storybook',
      configType: 'DEVELOPMENT',
      ignorePreview: !!cliOptions.previewUrl,
      docsMode: !!cliOptions.docs,
      cache,
    });
  } catch (error) {
    // this is a weird bugfix, somehow 'node-pre-gyp' is polluting the npmLog header
    npmLog.heading = '';

    if (error instanceof Error) {
      if ((error as any).error) {
        logger.error((error as any).error);
      } else if ((error as any).stats && (error as any).stats.compilation.errors) {
        (error as any).stats.compilation.errors.forEach((e: any) => logger.plain(e));
      } else {
        logger.error(error as any);
      }
    } else if (error.compilation?.errors) {
      error.compilation.errors.forEach((e: any) => logger.plain(e));
    }

    logger.line();
    logger.warn(
      error.close
        ? dedent`
          FATAL broken build!, will close the process,
          Fix the error below and restart storybook.
        `
        : dedent`
          Broken build, fix the error above.
          You may need to refresh the browser.
        `
    );
    logger.line();

    process.exit(1);
  }
}
