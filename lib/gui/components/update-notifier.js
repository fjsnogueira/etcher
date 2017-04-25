/*
 * Copyright 2016 resin.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

/**
 * @module Etcher.Components.UpdateNotifier
 */

const angular = require('angular');
const electron = require('electron');
const Bluebird = require('bluebird');
const _ = require('lodash');
const semver = require('semver');
const etcherLatestVersion = require('etcher-latest-version');
const units = require('../../shared/units');
const settings = require('../models/settings');

const MODULE_NAME = 'Etcher.Components.UpdateNotifier';
const UpdateNotifier = angular.module(MODULE_NAME, [
  require('../utils/manifest-bind/manifest-bind'),
  require('../os/open-external/open-external'),
  require('../modules/analytics')
]);

UpdateNotifier.service('UpdateNotifierService', function(
  $http,
  $q,
  ManifestBindService,
  AnalyticsService,
  OSOpenExternalService
) {

  /**
   * @summary The current application version
   * @constant
   * @private
   * @type {String}
   */
  const CURRENT_VERSION = ManifestBindService.get('version');

  /**
   * @summary The number of days the update notifier can be put to sleep
   * @constant
   * @private
   * @type {Number}
   */
  this.UPDATE_NOTIFIER_SLEEP_DAYS = 7;

  /**
   * @summary Get the latest available Etcher version
   * @function
   * @private
   * @description
   * We assume the received latest version number will not increase
   * while Etcher is running and memoize it
   *
   * @fulfil {String} - latest version
   * @returns {Promise}
   *
   * @example
   * UpdateNotifierService.getLatestVersion().then((latestVersion) => {
   *   console.log(`The latest version is: ${latestVersion}`);
   * });
   */
  this.getLatestVersion = _.memoize(() => {
    return $q((resolve, reject) => {
      return etcherLatestVersion((url, callback) => {
        return $http.get(url).then((response) => {
          return callback(null, response.data);
        }).catch((error) => {
          return callback(error);
        });
      }, (error, latestVersion) => {
        if (error) {

          // The error status equals this number if the request
          // couldn't be made successfully, for example, because
          // of a timeout on an unstable network connection.
          const ERROR_CODE_UNSUCCESSFUL_REQUEST = -1;

          if (error.status === ERROR_CODE_UNSUCCESSFUL_REQUEST) {
            return resolve(CURRENT_VERSION);
          }

          return reject(error);
        }

        return resolve(latestVersion);
      });
    });

  // Arbitrary identifier for the memoization function
  }, _.constant('latest-version'));

  /**
   * @summary Check if the current version is the latest version
   * @function
   * @public
   *
   * @fulfil {Boolean} - is latest version
   * @returns {Promise}
   *
   * @example
   * UpdateNotifierService.isLatestVersion().then((isLatestVersion) => {
   *   if (!isLatestVersion) {
   *     console.log('There is an update available');
   *   }
   * });
   */
  this.isLatestVersion = () => {
    return this.getLatestVersion().then((version) => {
      return semver.gte(CURRENT_VERSION, version);
    });
  };

  /**
   * @summary Determine if its time to check for updates
   * @function
   * @public
   *
   * @returns {Boolean} should check for updates
   *
   * @example
   * if (UpdateNotifierService.shouldCheckForUpdates()) {
   *   console.log('We should check for updates!');
   * }
   */
  this.shouldCheckForUpdates = () => {
    const lastUpdateNotify = settings.get('lastUpdateNotify');

    if (!settings.get('sleepUpdateCheck') || !lastUpdateNotify) {
      return true;
    }

    if (lastUpdateNotify - Date.now() > units.daysToMilliseconds(this.UPDATE_NOTIFIER_SLEEP_DAYS)) {
      settings.set('sleepUpdateCheck', false);
      return true;
    }

    return false;
  };

  /**
   * @summary Open the update notifier widget
   * @function
   * @public
   *
   * @returns {Promise}
   *
   * @example
   * UpdateNotifierService.notify();
   */
  this.notify = () => {
    return this.getLatestVersion().then((version) => {
      settings.set('lastUpdateNotify', Date.now());
      settings.set('sleepUpdateCheck', false);

      return new Bluebird((resolve) => {
        const BUTTONS = [
          'Download',
          'Skip'
        ];

        const BUTTON_CONFIRMATION_INDEX = _.indexOf(BUTTONS, _.first(BUTTONS));
        const BUTTON_REJECTION_INDEX = _.indexOf(BUTTONS, _.last(BUTTONS));

        electron.remote.dialog.showMessageBox(electron.remote.getCurrentWindow(), {
          type: 'info',
          buttons: BUTTONS,
          defaultId: BUTTON_CONFIRMATION_INDEX,
          cancelId: BUTTON_REJECTION_INDEX,
          title: 'New Update Available!',
          message: `Etcher ${version} is available for download`,
          checkboxLabel: `Remind me again in ${this.UPDATE_NOTIFIER_SLEEP_DAYS} days`,
          checkboxChecked: false
        }, (response, checkboxChecked) => {
          return resolve({
            agreed: response === BUTTON_CONFIRMATION_INDEX,
            sleepUpdateCheck: checkboxChecked
          });
        });
      }).then((results) => {
        settings.set('sleepUpdateCheck', results.sleepUpdateCheck);

        AnalyticsService.logEvent('Close update modal', {
          sleepUpdateCheck: results.sleepUpdateCheck,
          notifyVersion: version
        });

        if (results.agreed) {
          OSOpenExternalService.open('https://etcher.io?ref=etcher_update');
        }
      });
    });
  };

});

module.exports = MODULE_NAME;
