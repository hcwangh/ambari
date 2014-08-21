/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var App = require('app');
var blueprintUtils = require('utils/blueprint');

App.ServerValidatorMixin = Em.Mixin.create({

  /**
   * @type {bool} set true if at leasst one config has error
   */
  configValidationError: false,

  /**
   * @type {bool} set true if at leasst one config has warning
   */
  configValidationWarning: false,

  /**
   * @type {bool} set true if at leasst one config has warning
   */
  configValidationFailed: false,

  /**
   * recommendation configs loaded from server
   * (used only during install)
   * @type {Object}
   */
  recommendationsConfigs: null,

  loadAdditionalinfo: function() {
    return !(this.get('content.hosts') && this.get('content.hosts').length);
  }.property('content.hosts'),
  /**
   * by default loads data from model otherwise must be overridden as computed property
   * refer to \assets\data\stacks\HDP-2.1\recommendations_configs.json to learn structure
   * (shouldn't contain configurations filed)
   * @type {Object}
   */
  hostNames: function() {
    return this.get('content.hosts')
        ? Object.keys(this.get('content.hosts'))
        : this.get('allHostNames');
  }.property('content.hosts', 'allHostNames'),

  allHostNames: [],
  /**
   * by default loads data from model otherwise must be overridden as computed property
   * @type {Array} - of strings (serviceNames)
   */
  serviceNames: function() {
    return this.get('content.serviceName')
        ? [this.get('content.serviceName')]
        : App.StackService.find().filter(function(s){return s.get('isSelected') || s.get('isInstalled')}).mapProperty('serviceName');
  }.property('content.serviceName'),

  /**
   * by default loads data from model otherwise must be overridden as computed property
   * filter services that support server validation and concat with misc configs if Installer or current service
   * @type {Array} - of objects (services)
   */
  services: function() {
    return this.get('content.serviceName')
        ? [App.StackService.find(this.get('content.serviceName'))]
        : App.StackService.find().filter(function(s){
          return s.get('allowServerValidator') && (s.get('isSelected') || s.get('isInsalled'))
        }).concat(require("data/service_configs"));
  }.property('content.serviceName'),

  /**
   * by default loads data from model otherwise must be overridden as computed property
   * can be used for service|host configs pages
   * @type {Array} of strings (hostNames)
   */
  hostGroups: function() {
    return this.get('content.recommendationsHostGroups') || blueprintUtils.generateHostGroups(this.get('hostNames'), App.HostComponent.find());
  }.property('content.recommendationsHostGroups', 'hostNames'),

  /**
   * controller that is child of this mixis has to contain stepConfigs
   * @type {Array}
   */
  stepConfigs: null,

  /**
   * @method loadServerSideConfigsRecommendations
   * laod recommendations from server
   * (used only during install)
   * @returns {*}
   */
  loadServerSideConfigsRecommendations: function() {
    if (this.get('recommendationsConfigs') || !App.get('supports.serverRecommendValidate')) {
      return $.Deferred().resolve();
    }
    return App.ajax.send({
      'name': 'wizard.step7.loadrecommendations.configs',
      'sender': this,
      'data': {
        stackVersionUrl: App.get('stackVersionURL'),
        hosts: this.get('hostNames'),
        services: this.get('serviceNames'),
        recommendations: this.get('hostGroups')
      },
      'success': 'loadRecommendationsSuccess',
      'error': 'loadRecommendationsError'
    });
  },

  /**
   * @method loadRecommendationsSuccess
   * success callback after loading recommendations
   * (used only during install)
   * @param data
   */
  loadRecommendationsSuccess: function(data) {
    if (!data) {
      console.warn('error while loading default config values');
    }
    this.set("recommendationsConfigs", Em.get(data.resources[0] , "recommendations.blueprint.configurations"));
  },

  loadRecommendationsError: function() {
    console.error('Load recommendations failed');
  },

  serverSideValidation: function() {
    var deferred = $.Deferred();
    if (!App.get('supports.serverRecommendValidate')) {
      deferred.resolve();
    } else {
      this.set('configValidationFailed', false);
      if (this.get('loadAdditionalinfo')) {
        var self = this;
        this.getHostNames().complete(function() {
          if (self.get('configValidationFailed')) {
            self.warnUser(deferred);
          } else {
            self.runServerSideValidation(deferred);
          }
        });
      } else {
        this.runServerSideValidation(deferred);
      }
    }
    return deferred;
  },

  getHostNames: function() {
    return App.ajax.send({
      name: 'hosts.all',
      sender: this,
      success: 'getHostNamesSuccess',
      error: 'getHostNamesError'
    })
  },

  getHostNamesSuccess: function(data) {
    this.set("allHostNames", data.items.mapProperty("Hosts.host_name"));
  },

  getHostNamesError: function() {
    this.set('configValidationFailed', true);
    console.error('failed to load hostNames');
  },
  /**
   * @method serverSideValidation
   * send request to validate configs
   * @returns {*}
   */
  runServerSideValidation: function(deferred) {
    var self = this;
    var recommendations = this.get('hostGroups');
    recommendations.blueprint.configurations = blueprintUtils.buildConfisJSON(this.get('services'), this.get('stepConfigs'));
    return App.ajax.send({
      name: 'config.validations',
      sender: this,
      data: {
        stackVersionUrl: App.get('stackVersionURL'),
        hosts: this.get('hostNames'),
        services: this.get('serviceNames'),
        validate: 'configurations',
        recommendations: recommendations
      },
      success: 'validationSuccess',
      error: 'validationError'
    }).complete(function() {
      self.warnUser(deferred);
    });
  },


  /**
   * @method validationSuccess
   * success callback after getting responce from server
   * go through the step configs and set warn and error messages
   * @param data
   */
  validationSuccess: function(data) {
    var self = this;
    self.set('configValidationError', false);
    self.set('configValidationWarning', false);
    data.resources.forEach(function(r) {
      r.items.forEach(function(item){
        if (item.type == "configuration") {
          self.get('stepConfigs').forEach(function(service) {
            service.get('configs').forEach(function(property) {
              if ((property.get('filename') == item['config-type'] + '.xml') && (property.get('name') == item['config-name'])) {
                if (item.level == "ERROR") {
                  self.set('configValidationError', true);
                  property.set('errorMessage', item.message);
                  property.set('error', true);
                } else if (item.level == "WARN") {
                  self.set('configValidationWarning', true);
                  property.set('warnMessage', item.message);
                  property.set('warn', true);
                }
              }
            });
          })
        }
      });
    });
  },

  validationError: function() {
    this.set('configValidationFailed', true);
    console.error('config validation failed');
  },


  /**
   * warn user if some errors or warning were
   * in seting up configs otherwise go to the nex operation
   * @param deferred
   * @returns {*}
   */
  warnUser: function(deferred) {
    var self = this;
    if (this.get('configValidationFailed')) {
      this.set('isSubmitDisabled', false);
      this.set("isApplyingChanges", false);
      deferred.reject();
      return App.showAlertPopup(Em.I18n.t('installer.step7.popup.validation.failed.header'), Em.I18n.t('installer.step7.popup.validation.request.failed.body'));
    } else if (this.get('configValidationError')) {
      this.set("isApplyingChanges", false);
      this.set('isSubmitDisabled', true);
      deferred.reject();
      return App.showAlertPopup(Em.I18n.t('installer.step7.popup.validation.failed.header'), Em.I18n.t('installer.step7.popup.validation.failed.body'));
    } else if (this.get('configValidationWarning')) {
      this.set('isSubmitDisabled', true);
      this.set("isApplyingChanges", false);
      return App.showConfirmationPopup(function () {
        self.set('isSubmitDisabled', false);
        self.set("isApplyingChanges", true);
        deferred.resolve();
      }, Em.I18n.t('installer.step7.popup.validation.warning.body'));
    } else {
      deferred.resolve();
    }
  }
});
