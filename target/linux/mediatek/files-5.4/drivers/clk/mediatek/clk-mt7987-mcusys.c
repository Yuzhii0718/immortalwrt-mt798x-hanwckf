// SPDX-License-Identifier: GPL-2.0
/*
 * Copyright (c) 2024 MediaTek Inc.
 * Author: Sam Shih <sam.shih@mediatek.com>
 */

#include <linux/clk-provider.h>
#include <linux/of.h>
#include <linux/of_address.h>
#include <linux/of_device.h>
#include <linux/platform_device.h>
#include "clk-mtk.h"
#include "clk-gate.h"
#include "clk-mux.h"
#include <dt-bindings/clock/mediatek,mt7987-clk.h>

static DEFINE_SPINLOCK(mt7987_clk_lock);
static const char *const mcu_bus_div_parents[] = { "cb_cksq_40m", "arm_ll" };

/*
 * NOTE: 0x7C0 is a plain read-modify-write register (no set/clr/upd), so use
 * the composite mux (generic clk_mux_ops, shifted mask) like kernel 6.12.
 * mtk_mux_ops' set_parent does not shift the mask, so bit 9 never switched
 * and the CPU stayed on arm_ll while cpufreq reprogrammed the PLL.
 */
static struct mtk_composite mcu_muxes[] = {
	MUX_GATE_FLAGS(CK_MCU_BUS_DIV_SEL, "mcu_bus_div_sel",
		       mcu_bus_div_parents, 0x7C0, 9, 1, -1, CLK_IS_CRITICAL),
};

static void __init mtk_mcusys_init(struct device_node *node)
{
	struct clk_onecell_data *clk_data;
	int r;
	void __iomem *base;

	base = of_iomap(node, 0);
	if (!base) {
		pr_err("%s(): ioremap failed\n", __func__);
		return;
	}

	clk_data = mtk_alloc_clk_data(CLK_MCU_NR_CLK);

	mtk_clk_register_composites(mcu_muxes, ARRAY_SIZE(mcu_muxes), base,
				    &mt7987_clk_lock, clk_data);

	r = of_clk_add_provider(node, of_clk_src_onecell_get, clk_data);

	if (r)
		pr_err("%s(): could not register clock provider: %d\n",
		       __func__, r);
}
CLK_OF_DECLARE(mtk_mcusys, "mediatek,mt7987-mcusys", mtk_mcusys_init);
