# -*- coding: utf-8 -*-
import clr

clr.AddReference("Kingdee.BOS")
clr.AddReference("Kingdee.BOS.Core")


def PreOpenForm(e):
    if str(e.OpenParameter.FormId).lower() != "sfc_operationpickmtrlwork":
        return

    opt_ids = e.OpenParameter.GetCustomParameter("optIds")
    selected_count = opt_ids.Count if opt_ids is not None else 0
    if selected_count < 1000:
        return

    try:
        parent = e.ParentView
        if parent is None:
            raise Exception(u"未取得父列表")
        page_rows = parent.CurrentPageRowsInfo
        if page_rows is None or page_rows.Count == 0:
            raise Exception(u"未取得当前页工序")

        selected_ids = set(str(value) for value in opt_ids)
        page_ids = set()
        for row in page_rows:
            values = row.FieldValues
            if not values.ContainsKey("FSubEntity"):
                raise Exception(u"当前页行缺少工序内码 FSubEntity")
            value = str(values["FSubEntity"])
            if not value or value == "0":
                raise Exception(u"当前页存在无效工序内码")
            page_ids.add(value)

        if page_ids.issubset(selected_ids):
            e.Cancel = True
            e.CancelMessage = (
                u"已选中当前页全部工序，合计选中{0}行。"
                u"为避免误全选领料，本次操作已阻止。"
                u"请取消全选，筛选并勾选实际需要领料的工序。"
            ).format(selected_count)

    except Exception as ex:
        e.Cancel = True
        e.CancelMessage = (
            u"已选中{0}行，但无法核实当前页全选状态：{1}。"
            u"本次暂不打开领料平台，请联系管理员。"
        ).format(selected_count, str(ex))
