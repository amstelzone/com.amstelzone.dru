'use strict';

const Homey = require('homey');
const modbus = require('jsmodbus');
const net = require('net');

/* DRU Codes INPUTS */
const FIREPLACE_ACTION_REG = 40200; 
/*
101 -> Main On
3 -> Main Off
102 -> Secondary On
4 -> Secondary Off
*/
const REQ_FLAME_HIGHT = 40201; 
/*
Heights between 0 & 100
*/

/* DRU Codes OUTPUTS */
const FIREPLACE_STATUS_REG = 40203; /* 1 */
const FAULT_DETAIL_REG = 40204; /* 1 */
const RSSI_GATEWAY_REG = 40205; /* 1 */
const RSSI_DFGT_REG = 40206; /* 1 */
const ROOM_TEMPERATURE_REG = 40207; /* 1 */

class DruModbusDevice extends Homey.Device {

  onInit() {

    this.log('device init');
    this.log('name:', this.getName());
    this.log('class:', this.getClass());

    // Register a capability listener        
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    //this.registerCapabilityListener('onoff.secondary', this.onCapabilityOnoffSecondary.bind(this));
    this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));

    this.setCapabilityValue('onoff', false);
   // this.setCapabilityValue('onoff.secondary',  false);
    this.setCapabilityValue('dim', 0);

    if (this.getClass() !== 'heater') {
      this.setClass('heater');
    }

    this._connect();

  }

  onDeleted() {
    clearInterval(this.pollingInterval);
  }

  async onCapabilityOnoff( value, opts ) {

		// ... set value to real device, e.g.
    // await setMyDeviceState({ on: value });

    let action;

    value ? action = 101 : action = 3;

    Promise.all([
      this.client.writeSingleRegister(FIREPLACE_ACTION_REG, action)
    ]).then((results) => {
      var fireplace_action = results[0].response._body._valuesAsArray;
      this.getDeviceData();
    })
    .catch((err) => {
      this.log("OnOff: " + JSON.stringify(err));
    })

		// or, throw an error
	  //	throw new Error('Switching the device on/off failed!');
  }
  
  async onCapabilityOnoffSecondary( value, opts ) {

		// ... set value to real device, e.g.
    // await setMyDeviceState({ on: value });

    let action;

    value ? action = 102 : action = 4;

    Promise.all([
      this.client.writeSingleRegister(FIREPLACE_ACTION_REG, action)
    ]).then((results) => {
      var fireplace_action = results[0].response._body._valuesAsArray;

      this.log(JSON.stringify(results));
      this.getDeviceData();

    })
    .catch((err) => {
      this.log("OnOff2 :" + JSON.stringify(err));
    })
  
		// or, throw an error
  	//	throw new Error('Switching the device second burner on/off failed!');
	}
  async onCapabilityDim( value, opts ) {

		// ... set value to real device, e.g.
    // await setMyDeviceState({ on: value });
    if(this.getCapabilityValue('onoff') == true) {
      let setHeight = parseInt(value * 100);
      this.log(setHeight);
      if(setHeight >= 0 && setHeight <= 100){
        Promise.all([
          this.client.writeSingleRegister( REQ_FLAME_HIGHT, setHeight)
        ]).then((results) => {
          //var fireplace_height = results[0].response._body._valuesAsArray;

          this.setCapabilityValue('dim', value);
          this.log(JSON.stringify(results));
        })
        .catch((err) => {
          this.log("Dim :" + JSON.stringify(err));
        })

        this.getDeviceData();
      
      }
    }
    else {
      this.setCapabilityValue('dim', 0);
    }
		// or, throw an error
	  //	throw new Error('Dimming the device failed!');
  }


  getDeviceData () {
    Promise.all([
      this.client.readHoldingRegisters(FIREPLACE_STATUS_REG, 1),
      this.client.readHoldingRegisters(FAULT_DETAIL_REG, 1),
      this.client.readHoldingRegisters(RSSI_GATEWAY_REG, 1),
      this.client.readHoldingRegisters(RSSI_DFGT_REG, 1),
      this.client.readHoldingRegisters(ROOM_TEMPERATURE_REG, 1),
      this.client.readHoldingRegisters(REQ_FLAME_HIGHT, 1)
    ]).then((results) => {
      var fireplace_status = results[0].response._body._valuesAsArray;
      var fault_number = results[1].response._body._valuesAsArray;
      var rssi_gw = results[2].response._body._valuesAsArray;
      var rssi_dfgt = results[3].response._body._valuesAsArray;
      var room_temperature = results[4].response._body._valuesAsArray / 10;
      var flame = results[5].response._body._valuesAsArray[0];

      /* FAULT NUMBER */
      if (fault_number != 0 ) this.log("Fault! : " + fault_number );

      /* FIREPLACE STATUS */ 
      let settings = {};
      settings.pilot = (fireplace_status & 2) ? true : false;
      settings.main = (fireplace_status & 4) ? true : false;
      settings.secondary = (fireplace_status & 8) ? true : false;
      settings.light = (fireplace_status & 256) ? true : false;
      settings.rcbound = (fireplace_status & 2048) ? "connected" : "disconnected";
      settings.flame_possible = (fireplace_status & 32768) ? "ignition currently not possible" : "ignition possible";
      settings.roomtemperature = room_temperature;
      flame > 100 ? settings.flame_height = 0 : settings.flame_height = flame;
    

      /* RSSI GATEWAY  */ 
      let gwRSSI = -0.5*rssi_gw;
      if(gwRSSI > -55) settings.rssi_gateway = 'very good';
      else if(gwRSSI > -70) settings.rssi_gateway = "good";
      else if(gwRSSI > -80) settings.rssi_gateway = "bad";
      else if(gwRSSI < -80) settings.rssi_gateway = "very bad";
  
      /* RSSI DFGT */ 
      let dfgtRSSI = -0.5*rssi_dfgt;
      if(dfgtRSSI > -55) settings.rssi_dfgt = 'very good';
      else if(dfgtRSSI > -70) settings.rssi_dfgt = "good";
      else if(dfgtRSSI > -80) settings.rssi_dfgt = "bad";
      else if(dfgtRSSI < -80) settings.rssi_dfgt = "very bad";

      /* SETTING DRU VALUES TO HOMEY */
      this.setCapabilityValue('onoff', settings.main);
    //  this.setCapabilityValue('onoff.secondary',  settings.secondary);
      this.setCapabilityValue('measure_temperature', settings.roomtemperature);
      this.setCapabilityValue('dim', (settings.flame_height / 100));

    //  this.log("Fireplace status : " + JSON.stringify(settings) );


    }).catch((err) => {
      this.log("Error 1" + JSON.stringify(err));
      if (err.err != "ModbusException") {
        clearInterval(this.pollingInterval);
        this._connect(); 
      }
    })
  }

  _connect() {
    
    this.log('_connect');
    
    if (this.client) {
      delete this.client;
      this.log("1a");
    }
    this.log("1b");
    if (this.socket) {
        this.socket.destroy();
        delete this.socket;
        this.log("2");
    }

    let options = {
      'host': this.getSetting('address'),
      'port': this.getSetting('port'),
      'unitId': 2,
      'timeout': 5000,
      'autoReconnect': false,
      'reconnect':false,
      'forceNew': true,
      'reconnectTimeout': this.getSetting('polling'),
      'logLabel' : 'Dru Controller',
      'logLevel': 'debug',
      'logEnabled': true
    }

    this.socket = new net.Socket();
    this.client = new modbus.client.TCP(this.socket, 2);

    this.socket.connect(options);

    this.socket.on('connect', () => {

      this.log('Connected ...');
      if (!this.getAvailable()) {
        this.setAvailable();
      }

      this.pollingInterval = setInterval(() => {
        this.getDeviceData();
      }, this.getSetting('polling') * 1000)

    })

    this.socket.on('error', (err) => {
      this.log("Error2: " + err);
      this.setUnavailable(err.err);
      setTimeout(() => {
       this._connect();
        this.log('Reconnecting now ...');
      }, 63000)
    })

    this.socket.on('disconnect', () => {
      this.log('Client closed, retrying in 63 seconds');
      
      clearInterval(this.pollingInterval);

      setTimeout(() => {
       this._connect();
        this.log('Reconnecting now ...');
      }, 63000)
    })
  }

}

module.exports = DruModbusDevice;
