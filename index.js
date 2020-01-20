const pynode = require('pynode-fix')
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-rpi-rf-switch", "rfSwitch", rfSwitchPlatform, true);
}

function rfSwitchPlatform(log, config, api) {
    this.log = log;
    this.config = config;

    this.gpio = config.gpio || 17;
    this.libpython = config.libpython || 'python3.7m';

    this.accessories = [];

    this.commandQueue = [];
    this.transmitting = false;

    pynode.dlOpen('lib' + this.libpython + '.so')
    pynode.startInterpreter();
    pynode.appendSysPath(__dirname);
    pynode.openFile('sendRf');

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

rfSwitchPlatform.prototype.configureAccessory = function(accessory) {
    this.setService(accessory);
    this.accessories.push(accessory);
}

rfSwitchPlatform.prototype.didFinishLaunching = function() {
    var serials = [];
    this.config.devices.forEach(device => {
        this.addAccessory(device);
        serials.push(device.on_code + ':' + device.off_code);
    });

    var badAccessories = [];
    this.accessories.forEach(cachedAccessory => {
        if (!serials.includes(cachedAccessory.context.serial)) {
            badAccessories.push(cachedAccessory);
        }
    });
    this.removeAccessories(badAccessories);
}

rfSwitchPlatform.prototype.addAccessory = function(data) {
    this.log("Initializing platform accessory '" + data.name + "'...");
    data.serial = data.on_code + ":" + data.off_code;

    if (!data.pulselength) {
        data.pulselength = -1;
    }
    if (!data.protocol) {
        data.protocol = -1;
    }
    if (!data.length) {
        data.codelength = -1;
    }
    if (!data.repeat) {
        data.repeat = 10;
    }

    var accessory;
    this.accessories.forEach(cachedAccessory => {
        if (cachedAccessory.context.serial == data.serial) {
            accessory = cachedAccessory;
        }
    });

    if (!accessory) {
        var uuid = UUIDGen.generate(data.serial);
        accessory = new Accessory(data.name, uuid);

        accessory.context = data;

        accessory.addService(Service.Switch, data.name);

        accessory.reachable = true;

        this.setService(accessory);

        this.api.registerPlatformAccessories("homebridge-rpi-rf-switch", "rfSwitch", [accessory]);

        this.accessories.push(accessory);
    } else {
        accessory.context = data;
    }

    this.getInitState(accessory);
}

rfSwitchPlatform.prototype.removeAccessories = function(accessories) {
    accessories.forEach(accessory => {
        this.log(accessory.context.name + " is removed from HomeBridge.");
        this.api.unregisterPlatformAccessories("homebridge-honeywell-leak", "honeywellLeak", [accessory]);
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
    });
}

rfSwitchPlatform.prototype.setService = function(accessory) {
    accessory.getService(Service.Switch)
        .getCharacteristic(Characteristic.On)
        .on('set', this.setPowerState.bind(this, accessory));

    accessory.on('identify', this.identify.bind(this, accessory));
}

rfSwitchPlatform.prototype.getInitState = function(accessory) {
    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Sunoo")
        .setCharacteristic(Characteristic.Model, "rpi-rf")
        .setCharacteristic(Characteristic.SerialNumber, accessory.context.serial);

    accessory.getService(Service.Switch)
        .getCharacteristic(Characteristic.On)
        .getValue();

    accessory.updateReachability(true);
}

rfSwitchPlatform.prototype.setPowerState = function(accessory, state, callback) {
    this.commandQueue.push({
        'accessory': accessory,
        'state': state,
        'callback': callback
    });
    if (!this.transmitting) {
        this.transmitting = true;
        this.nextCommand.bind(this)();
    }
}

rfSwitchPlatform.prototype.nextCommand = function() {
    let todoItem = this.commandQueue.shift();
    let accessory = todoItem['accessory'];
    let state = todoItem['state'];
    let callback = todoItem['callback'];

    var code = state ? accessory.context.on_code : accessory.context.off_code;

    new Promise((resolve, reject) => {
            pynode.call('send', code, this.gpio, accessory.context.pulselength, accessory.context.protocol,
                accessory.context.codelength, accessory.context.repeat, (err, result) => {
                    if (err) reject(err);
                    resolve(result);
                })
        }).then(result => {
            this.log(accessory.context.name + " is turned " + (state ? "on." : "off."))
            accessory.context.state = state;

            if (this.commandQueue.length > 0) {
                this.nextCommand.bind(this)();
            } else {
                this.transmitting = false;
            }

            callback();
        })
        .catch(err => {
            this.log("Failed to turn " + (state ? "on " : "off ") + accessory.context.name);
            this.log(err);
        });
}

rfSwitchPlatform.prototype.identify = function(thisSwitch, paired, callback) {
    this.log(thisSwitch.context.name + "identify requested!");
    callback();
}