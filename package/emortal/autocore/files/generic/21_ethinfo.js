'use strict';
'require baseclass';
'require fs';
'require rpc';
'require network';

let callSwconfigPortState = rpc.declare({
  object: 'luci',
  method: 'getSwconfigPortState',
  params: ['switch'],
  expect: { result: [] }
});

let callLuciBoardJSON = rpc.declare({
  object: 'luci-rpc',
  method: 'getBoardJSON',
  expect: { '': {} }
});

let callLuciNetworkDevices = rpc.declare({
  object: 'luci-rpc',
  method: 'getNetworkDevices',
  expect: { '': {} }
});

function getSwitchPortFlow() {
  const portFlow = [];
  fs.exec('/sbin/swconfig', ['dev', 'switch0', 'show']).then((res) => {
    const lines = res.stdout.trim().split(/\n/);
    let portNum;
    for (let line of lines) {
      let match = line.match(/^Port\s+(\d+):$/);
      if (match != null) {
        portNum = Number(match[1]);
        portFlow[portNum] = {};
        continue;
      }
      match = line.match(/^TxByte\s*:\s*(\d+)$/);
      if (match != null) {
        portFlow[portNum].rxflow = Number(match[1]);
        continue;
      }
      match = line.match(/^RxByte\s*:\s*(\d+)$/);
      if (match != null) {
        portFlow[portNum].txflow = Number(match[1]);
        continue;
      }
    }
  });
  return portFlow;
}

function formatSpeed(speed) {
  if (speed <= 0) return '-';
  const speedInt = parseInt(speed);
  if (isNaN(speedInt)) return '-';
  return speedInt < 1000 ? `${speedInt} M` : `${speedInt / 1000} GbE`;
}

function getPortColor(carrier, duplex) {
  if (!carrier) return 'Gainsboro;';
  if (duplex === 'full' || duplex === true) return 'greenyellow;';
  return 'darkorange';
}

function getPortIcon(carrier) {
  return L.resource(`icons/port_${carrier ? 'up' : 'down'}.png`);
}

function getPorts(board, netdevs, switches, portflow) {
  const ports = [];

  if (Object.keys(switches).length === 0) {
    const network = board.network;
    const ifnames = [network?.wan?.device].concat(network?.lan?.ports);
    for (const ifname of ifnames) {
      if (ifname in netdevs === false) continue;
      const dev = netdevs[ifname];
      ports.push({
        ifname: dev.name,
        carrier: dev.link.carrier,
        duplex: dev.link.duplex,
        speed: dev.link.speed,
        txflow: dev.stats.tx_bytes,
        rxflow: dev.stats.rx_bytes
      });
    }
    return ports;
  }

  let wanInSwitch;
  const switch0 = switches['switch0'];
  const lan = netdevs['br-lan'];
  const wan = netdevs[board.network.wan.device];
  for (const port of switch0.ports) {
    const label = port.label.toUpperCase();
    const portstate = switch0.portstate[port.num];
    portstate.ifname = label;
    portstate.carrier = portstate.link;
    if (portflow[port.num]) {
      portstate.txflow = portflow[port.num].txflow;
      portstate.rxflow = portflow[port.num].rxflow;
    }
    if (label.startsWith('WAN')) {
      wanInSwitch = true;
      if (!portstate.rxflow && wan) {
        portstate.txflow = wan.stats.tx_bytes;
        portstate.rxflow = wan.stats.rx_bytes;
      }
      ports.unshift(portstate);
    } else if (label.startsWith('LAN')) {
      if (!portstate.rxflow && lan) {
        portstate.txflow = lan.stats.tx_bytes;
        portstate.rxflow = lan.stats.rx_bytes;
      }
      ports.push(portstate);
    }
  }
  if (wanInSwitch) return ports;

  if (wan) {
    ports.unshift({
      ifname: 'WAN',
      carrier: wan.link.carrier,
      duplex: wan.link.duplex,
      speed: wan.link.speed,
      txflow: wan.stats.tx_bytes,
      rxflow: wan.stats.rx_bytes
    });
  }
  return ports;
}

function renderPorts(data) {
  const css = {
    grids: `
      display: grid; grid-gap: 5px 10px;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      margin-bottom: 1em;
    `,
    head: `
      color: Black;
      text-align: center;
      font-weight: bold;
      border-radius: 7px 7px 0 0;
    `,
    body: `
      border: 1px solid lightgrey;
      border-radius: 0 0 7px 7px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;`,
    icon: 'margin: 5px; width: 32px;',
    speed: 'font-size: 0.8rem; font-weight: bold;',
    flow: `
      border-top: 1px solid lightgrey;
      font-size: 0.8rem;`
  };

  const ports = [];
  getPorts(...data).forEach((port) => {
    const { carrier, duplex } = port;
    const ifname = port.ifname.replace(' ', '');
    const color = `background-color: ${getPortColor(carrier, duplex)};`;
    ports.push(
      E('div', {}, [
        E('div', { style: css.head + color }, ifname),
        E('div', { style: css.body }, [
          E('img', { style: css.icon, src: getPortIcon(carrier) }),
          E('div', { style: css.speed }, formatSpeed(port.speed)),
          E('div', { style: css.flow }, [
            '\u25b2\u202f%1024.1mB'.format(carrier ? port.txflow : 0),
            E('br'),
            '\u25bc\u202f%1024.1mB'.format(carrier ? port.rxflow : 0)
          ])
        ])
      ])
    );
  });

  return E('div', { style: css.grids }, ports);
}

return baseclass.extend({
  title: _('Ethernet Information'),

  load: function () {
    return Promise.all([
      L.resolveDefault(callLuciBoardJSON(), {}),
      L.resolveDefault(callLuciNetworkDevices(), {}),
      network.getSwitchTopologies().then((topologies) => {
        if (Object.keys(topologies).length === 0) return {};
        callSwconfigPortState('switch0').then((portstate) => {
          topologies['switch0'].portstate = portstate;
        });
        return topologies;
      }),
      network.getSwitchTopologies().then((topologies) => {
        if (Object.keys(topologies).length === 0) return [];
        return getSwitchPortFlow();
      })
    ]);
  },

  render: function (data) {
    return renderPorts(data);
  }
});
