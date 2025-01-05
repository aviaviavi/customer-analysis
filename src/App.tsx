import { useState } from 'react';
import { Box, Container, Paper, Typography, Button, TextField, Tooltip } from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import Papa, { ParseResult } from 'papaparse';
import * as XLSX from 'xlsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

interface CustomerData {
  Customer: string;
  'Customer Start Date': string;
  'Customer End Date': string;
  [key: string]: string; // For dynamic date columns
}

interface MetricsData {
  date: string;
  mrr: number;
  arr: number;
  growthRate: number;
  nrr: number;
  netNewRevenue: number;
  acv: number;
  quarterlyMrr?: number;
  quarterlyArr?: number;
  quarterlyGrowth?: number;
  quarterlyNrr?: number;
  quarterlyNetNew?: number;
  quarterlyAcv?: number;
  formattedQuarter?: string;
}

interface CustomerSummary {
  id: string;
  customer: string;
  startDate: string;
  endDate: string;
  currentMrr: number;
  lastQuarterMrr: number;
  arr: number;
  quarterlyChange: number;
  status: string;
}

interface CohortData {
  cohort: string;
  initialCustomers: number;
  initialRevenue: number;
  periods: {
    retained: number;
    revenue: number;
    retentionRate: number;
    revenueRate: number;
  }[];
}

function App() {
  const [customerData, setCustomerData] = useState<CustomerData[]>([]);
  const [metrics, setMetrics] = useState<MetricsData[]>([]);
  const [customerSummaries, setCustomerSummaries] = useState<CustomerSummary[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<CustomerSummary[]>([]);
  const [monthlyVisibleSeries, setMonthlyVisibleSeries] = useState({
    mrr: true,
    arr: true,
    nrr: true,
    acv: true
  });
  const [quarterlyVisibleSeries, setQuarterlyVisibleSeries] = useState({
    mrr: true,
    arr: true,
    nrr: true,
    acv: true
  });
  const [cohortData, setCohortData] = useState<CohortData[]>([]);

  const cleanCurrencyString = (value: string | number): number => {
    // If it's already a number, return it
    if (typeof value === 'number') return value;
    
    // If it's undefined, null, or empty string
    if (!value) return 0;
    
    // Convert to string and clean it
    const strValue = String(value);
    if (strValue.trim() === '-' || strValue.trim() === '$-' || strValue.trim() === 'N/A') return 0;
    
    // Remove spaces, dollar signs, and commas, then parse as float
    const cleanValue = strValue.replace(/[\s$,]/g, '');
    const numValue = parseFloat(cleanValue);
    return isNaN(numValue) ? 0 : numValue;
  };

  const calculateMetrics = (data: CustomerData[]) => {
    if (!data.length) return;

    // Filter out the Totals row and empty rows
    const customerData = data.filter(row => 
      row.Customer && 
      row.Customer !== 'Totals' && 
      row.Customer.trim() !== ''
    );

    const dateColumns = Object.keys(customerData[0])
      .filter(key => /^\d{4}-\d{2}$/.test(key))
      .sort();

    // Calculate monthly metrics
    const metricsData: MetricsData[] = dateColumns.map((date, index) => {
      // Calculate MRR (sum of all revenue for the month)
      const mrr = customerData.reduce((sum, customer) => {
        const revenue = cleanCurrencyString(customer[date]);
        return sum + revenue;
      }, 0);

      // Calculate ARR (MRR * 12)
      const arr = mrr * 12;

      // Calculate new revenue (annualized)
      let netNewRevenue = 0;
      if (index > 0) {
        const previousDate = dateColumns[index - 1];

        // Calculate only positive MRR changes (new and expansion revenue)
        const mrrChanges = customerData.map(customer => {
          const currentMrr = cleanCurrencyString(customer[date]);
          const previousMrr = cleanCurrencyString(customer[previousDate]);
          const mrrChange = currentMrr - previousMrr;
          // Only include positive changes
          return mrrChange > 0 ? mrrChange : 0;
        });

        // Sum up all positive MRR changes and annualize
        netNewRevenue = mrrChanges.reduce((sum, change) => sum + change, 0) * 12;
      }

      // Calculate growth rate (compared to previous quarter)
      let growthRate = 0;
      if (index > 0) {
        const previousARR = customerData.reduce((sum, customer) => {
          const revenue = cleanCurrencyString(customer[dateColumns[index - 3]]) * 12;
          return sum + revenue;
        }, 0);
        growthRate = previousARR ? ((arr - previousARR) / previousARR) * 100 : 0;
      }

      // Calculate NRR (Net Revenue Retention)
      let nrr = 0;
      if (index > 0) {
        const previousMonthCustomers = new Set(
          customerData
            .filter(customer => {
              const revenue = cleanCurrencyString(customer[dateColumns[index - 1]]);
              return revenue > 0;
            })
            .map(customer => customer.Customer)
        );

        const previousRevenue = customerData
          .filter(customer => previousMonthCustomers.has(customer.Customer))
          .reduce((sum, customer) => {
            const revenue = cleanCurrencyString(customer[dateColumns[index - 1]]);
            return sum + revenue;
          }, 0);

        const currentRevenue = customerData
          .filter(customer => previousMonthCustomers.has(customer.Customer))
          .reduce((sum, customer) => {
            const revenue = cleanCurrencyString(customer[date]);
            return sum + revenue;
          }, 0);

        nrr = previousRevenue ? (currentRevenue / previousRevenue) * 100 : 100;
      }

      // Calculate ACV for this month
      const activeCustomers = customerData.filter(customer => 
        cleanCurrencyString(customer[date]) > 0
      ).length;
      
      const acv = activeCustomers ? (arr / activeCustomers) : 0;

      return {
        date,
        mrr,
        arr,
        growthRate,
        nrr,
        netNewRevenue,
        acv
      };
    });

    // Add quarterly metrics
    metricsData.forEach((metric) => {
      const [year, month] = metric.date.split('-').map(Number);
      const monthIndex = month - 1; // 0-based month index
      const quarter = Math.floor(monthIndex / 3) + 1; // 1-4 for Q1-Q4
      const isQuarterEnd = month % 3 === 0; // true for Mar, Jun, Sep, Dec

      if (isQuarterEnd) {
        // Use the current month's MRR for quarterly MRR (end of quarter)
        const quarterlyMrr = metric.mrr;
        const quarterlyArr = metric.arr;
        
        // Calculate quarterly net new revenue by comparing with previous quarter
        const prevQuarterMonth = month - 3;
        const prevQuarterYear = prevQuarterMonth < 1 ? year - 1 : year;
        const adjustedPrevMonth = prevQuarterMonth < 1 ? prevQuarterMonth + 12 : prevQuarterMonth;
        const previousQuarterDate = `${prevQuarterYear}-${String(adjustedPrevMonth).padStart(2, '0')}`;
        
        // Find the previous quarter's MRR
        const previousQuarterMetric = metricsData.find(m => m.date === previousQuarterDate);
        const previousQuarterlyMrr = previousQuarterMetric?.mrr || 0;

        // Calculate quarterly metrics
        const quarterlyGrowth = previousQuarterlyMrr 
          ? ((quarterlyMrr - previousQuarterlyMrr) / previousQuarterlyMrr) * 100
          : 0;

        // Calculate quarterly NRR by looking at revenue from customers active in previous quarter
        console.log(`\nCalculating Quarterly NRR for ${metric.date} (comparing with ${previousQuarterDate})`);
        
        const previousQuarterCustomers = new Set(
          customerData
            .filter(customer => {
              const revenue = cleanCurrencyString(customer[previousQuarterDate]);
              return revenue > 0;
            })
            .map(customer => customer.Customer)
        );

        console.log('Previous quarter active customers:', Array.from(previousQuarterCustomers));

        const previousQuarterRevenue = customerData
          .filter(customer => previousQuarterCustomers.has(customer.Customer))
          .reduce((sum, customer) => {
            const revenue = cleanCurrencyString(customer[previousQuarterDate]);
            return sum + revenue;
          }, 0);

        console.log('Previous quarter revenue:', previousQuarterRevenue);

        const currentQuarterRevenueFromPreviousCustomers = customerData
          .filter(customer => previousQuarterCustomers.has(customer.Customer))
          .reduce((sum, customer) => {
            const revenue = cleanCurrencyString(customer[metric.date]);
            console.log(`Customer ${customer.Customer}: Previous Q: ${cleanCurrencyString(customer[previousQuarterDate])}, Current Q: ${cleanCurrencyString(customer[metric.date])}`);
            return sum + revenue;
          }, 0);

        console.log('Current quarter revenue from previous customers:', currentQuarterRevenueFromPreviousCustomers);

        const quarterlyNrr = previousQuarterRevenue 
          ? (currentQuarterRevenueFromPreviousCustomers / previousQuarterRevenue) * 100
          : 100;

        console.log('Quarterly NRR:', quarterlyNrr, '%');

        // Calculate net new revenue (annualized)
        const quarterlyNetNew = (quarterlyMrr - previousQuarterlyMrr) * 12;

        const quarterlyActiveCustomers = customerData.filter(customer => 
          cleanCurrencyString(customer[metric.date]) > 0
        ).length;
        
        const quarterlyAcv = quarterlyActiveCustomers ? (quarterlyArr / quarterlyActiveCustomers) : 0;

        metric.quarterlyMrr = quarterlyMrr;
        metric.quarterlyArr = quarterlyArr;
        metric.quarterlyGrowth = quarterlyGrowth;
        metric.quarterlyNrr = quarterlyNrr;
        metric.quarterlyNetNew = quarterlyNetNew;
        metric.quarterlyAcv = quarterlyAcv;
        metric.formattedQuarter = `Q${quarter} '${String(year).slice(2)}`;
      }
    });

    setMetrics(metricsData);

    // Calculate customer summaries
    const lastMonth = dateColumns[dateColumns.length - 1];
    const lastQuarterMonth = dateColumns[dateColumns.length - 4] || lastMonth; // Fallback to last month if < 1 quarter of data

    const summaries: CustomerSummary[] = customerData.map(customer => {
      // Get current MRR
      const currentMrr = cleanCurrencyString(customer[lastMonth]);
      
      // Get last quarter's MRR
      const lastQuarterMrr = cleanCurrencyString(customer[lastQuarterMonth]);
      
      // Calculate ARR
      const arr = currentMrr * 12;
      
      // Calculate quarterly change
      const quarterlyChange = lastQuarterMrr ? ((currentMrr - lastQuarterMrr) / lastQuarterMrr) * 100 : 0;
      
      // Determine status
      const isActive = currentMrr > 0;

      const summary = {
        id: customer.Customer,
        customer: customer.Customer,
        startDate: customer['Customer Start Date'],
        endDate: customer['Customer End Date'],
        currentMrr,
        lastQuarterMrr,
        arr,
        quarterlyChange,
        status: isActive ? 'Active' : 'Churned'
      };

      return summary;
    });

    console.log('All summaries:', summaries); // Debug log
    setCustomerSummaries(summaries);
    setFilteredCustomers(summaries);

    const cohortAnalysis = calculateCohortData(data, dateColumns);
    setCohortData(cohortAnalysis);
  };

  const calculateCohortData = (data: CustomerData[], dateColumns: string[]): CohortData[] => {
    console.log('Date columns:', dateColumns);
    
    const cohortGroups = data.reduce((groups: { [key: string]: CustomerData[] }, customer) => {
      const startDate = customer['Customer Start Date'];
      if (!startDate || startDate === 'N/A') return groups;
      
      const cohortDate = new Date(startDate);
      const month = cohortDate.getMonth() + 1;
      const year = cohortDate.getFullYear();
      const cohort = `${year}-${String(month).padStart(2, '0')}`;
      
      if (!groups[cohort]) {
        groups[cohort] = [];
      }
      groups[cohort].push(customer);
      return groups;
    }, {});

    // Get the latest available date from dateColumns
    const latestAvailableDate = dateColumns[dateColumns.length - 1];
    const [latestYear, latestMonth] = latestAvailableDate.split('-').map(Number);

    return Object.entries(cohortGroups).map(([cohort, customers]) => {
      const [cohortYear, cohortMonth] = cohort.split('-').map(Number);
      
      // For future cohorts, return empty periods
      if (cohortYear > latestYear || (cohortYear === latestYear && cohortMonth > latestMonth)) {
        return {
          cohort,
          initialCustomers: customers.length,
          initialRevenue: 0,
          periods: []
        };
      }

      // Calculate number of periods from cohort start to latest available date
      const monthsDiff = (latestYear - cohortYear) * 12 + (latestMonth - cohortMonth);
      const periods = Array.from({ length: monthsDiff + 1 }, (_, index) => {
        const periodDate = new Date(cohortYear, cohortMonth - 1 + index);
        const periodKey = `${periodDate.getFullYear()}-${String(periodDate.getMonth() + 1).padStart(2, '0')}`;
        
        const activeCustomers = customers.filter(customer => 
          cleanCurrencyString(customer[periodKey] || 0) > 0
        ).length;

        const periodRevenue = customers.reduce((sum, customer) => 
          sum + cleanCurrencyString(customer[periodKey] || 0), 0);

        return {
          retained: activeCustomers,
          revenue: periodRevenue,
          retentionRate: (activeCustomers / customers.length) * 100,
          revenueRate: periodRevenue / (customers.reduce((sum, customer) => 
            sum + cleanCurrencyString(customer[cohort] || 0), 0)) * 100
        };
      });

      return {
        cohort,
        initialCustomers: customers.length,
        initialRevenue: customers.reduce((sum, customer) => 
          sum + cleanCurrencyString(customer[cohort] || 0), 0),
        periods
      };
    });
  };

  const handleExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Configure date formatting
      const options = { 
        raw: false,
        dateNF: 'yyyy-mm-dd'
      };
      
      const jsonData = XLSX.utils.sheet_to_json(worksheet, options) as CustomerData[];
      
      // Format dates consistently
      const formattedData = jsonData.map(row => ({
        ...row,
        'Customer Start Date': formatExcelDate(row['Customer Start Date']),
        'Customer End Date': formatExcelDate(row['Customer End Date'])
      }));
      
      // Filter out Totals and empty rows
      const filteredData = formattedData.filter(row => 
        row.Customer && 
        row.Customer !== 'Totals' && 
        row.Customer.trim() !== ''
      );
      
      setCustomerData(filteredData);
      calculateMetrics(filteredData);
    };
    reader.readAsBinaryString(file);
  };

  const formatExcelDate = (value: any): string => {
    if (!value) return 'N/A';
    if (value === 'N/A') return 'N/A';
    
    try {
      // Handle Excel serial numbers
      if (typeof value === 'number') {
        const date = XLSX.SSF.parse_date_code(value);
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
      
      // Handle string dates
      const date = new Date(value);
      if (isNaN(date.getTime())) return value;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    } catch (e) {
      return value;
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = file.name.split('.').pop()?.toLowerCase();
    
    if (fileType === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results: ParseResult<CustomerData>) => {
          const data = results.data.filter(row => 
            row.Customer && 
            row.Customer !== 'Totals' && 
            row.Customer.trim() !== ''
          );
          setCustomerData(data);
          calculateMetrics(data);
        }
      });
    } else if (fileType === 'xls' || fileType === 'xlsx') {
      handleExcelFile(file);
    }
  };

  const customerColumns: GridColDef[] = [
    { field: 'customer', headerName: 'Customer', width: 200 },
    { 
      field: 'startDate', 
      headerName: 'Start Date', 
      width: 120,
      sortComparator: (v1, v2) => {
        // Handle null/undefined values
        if (!v1) return -1;
        if (!v2) return 1;

        // If we already have Date objects
        if (v1 instanceof Date && v2 instanceof Date) {
          return v1.getTime() - v2.getTime();
        }

        try {
          // Try parsing as M/D/YY format first
          const parseDate = (val: any) => {
            if (val instanceof Date) return val;
            if (typeof val === 'string') {
              // Handle M/D/YY format
              if (val.includes('/')) {
                const parts = val.split('/').map((n, i) => i === 2 ? '20' + n : n);
                return new Date(parts.join('/'));
              }
              // Handle Excel date format (YYYY-MM-DD)
              return new Date(val);
            }
            return new Date(0); // fallback for invalid dates
          };

          return parseDate(v1).getTime() - parseDate(v2).getTime();
        } catch (e) {
          // If parsing fails, fall back to string comparison
          return String(v1).localeCompare(String(v2));
        }
      }
    },
    { 
      field: 'status',
      headerName: 'Status',
      width: 120
    },
    { 
      field: 'currentMrr',
      headerName: 'Current MRR',
      width: 130,
      type: 'number',
      valueFormatter: ( value ) => {
        if (value == null) return '$0.00';
        return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    },
    { 
      field: 'lastQuarterMrr',
      headerName: 'Last Q MRR',
      width: 130,
      type: 'number',
      valueFormatter: ( value ) => {
        if (value == null) return '$0.00';
        return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    },
    { 
      field: 'arr',
      headerName: 'ARR',
      width: 130,
      type: 'number',
      valueFormatter: ( value ) => {
        if (value == null) return '$0.00';
        return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    },
    { 
      field: 'quarterlyChange',
      headerName: 'Q/Q Change',
      width: 130,
      type: 'number',
      valueFormatter: ( value ) => {
        if (value == null) return '0.0%';
        return `${Number(value).toFixed(1)}%`;
      }
    }
  ];

  const CohortGrid = ({ data }: { data: CohortData[] }) => {
    const maxPeriods = Math.max(...data.map(cohort => cohort.periods.length));
    const periods = Array.from({ length: maxPeriods }, (_, i) => i);

    // Sort cohorts by date
    const sortedData = [...data].sort((a, b) => {
      // Parse YYYY-MM format strings
      const [yearA, monthA] = a.cohort.split('-').map(Number);
      const [yearB, monthB] = b.cohort.split('-').map(Number);
      
      // Compare years first
      if (yearA !== yearB) {
        return yearB - yearA;
      }
      // If years are equal, compare months
      return monthB - monthA;
    });

    // Format date to MMM YY
    const formatCohortDate = (dateStr: string) => {
      // Parse YYYY-MM format directly
      const [year, month] = dateStr.split('-').map(Number);
      
      // Create date string that will be interpreted as UTC
      const date = new Date(Date.UTC(year, month - 1));
      
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        year: '2-digit',
        timeZone: 'UTC'  // Ensure UTC interpretation
      });
    };

    return (
      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid rgba(224, 224, 224, 1)', minWidth: '80px' }}>Cohort</th>
              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Size</th>
              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Initial MRR</th>
              {periods.map(period => (
                <th key={period} style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  M{period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map(cohort => (
              <tr key={cohort.cohort}>
                <td style={{ padding: '8px', borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  {formatCohortDate(cohort.cohort)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  {cohort.initialCustomers}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  ${cohort.initialRevenue.toLocaleString()}
                </td>
                {periods.map(period => {
                  const periodData = cohort.periods[period];
                  return (
                    <td 
                      key={period} 
                      style={{ 
                        padding: '8px', 
                        textAlign: 'right', 
                        borderBottom: '1px solid rgba(224, 224, 224, 1)',
                        backgroundColor: periodData 
                          ? `rgba(25, 118, 210, ${periodData.revenueRate / 200})` 
                          : 'transparent'
                      }}
                    >
                      {periodData 
                        ? `${periodData.revenueRate.toFixed(0)}%` 
                        : '-'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          SaaS Revenue Analytics
        </Typography>
        
        <Paper sx={{ p: 2, mb: 2 }}>
          <Button
            variant="contained"
            component="label"
            sx={{ mb: 2 }}
          >
            Upload File
            <input
              type="file"
              hidden
              accept=".csv,.xls,.xlsx"
              onChange={handleFileUpload}
            />
          </Button>
          {!metrics.length && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Expected File Format
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Upload a CSV or Excel file with monthly revenue data. The file should include:
              </Typography>
              <Box sx={{ pl: 3, mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>• Customer name column</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>• Start date (M/D/YY format)</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>• End date (M/D/YY format or "N/A")</Typography>
                <Typography variant="body2" color="text.secondary">• Monthly revenue columns (YYYY-MM format)</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                💡 Stripe's MRR report is already in the correct format - just export and upload!
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: 'italic' }}>
                🔒 Your data is processed locally and never leaves your machine
              </Typography>
            </Box>
          )}
        </Paper>

        {metrics.length > 0 && (
          <>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Latest Metrics
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, mb: 4 }}>
                {/* Primary Metrics */}
                <Box sx={{ display: 'grid', gap: 3 }}>
                  <Tooltip title="Monthly Recurring Revenue - Sum of all active customer subscriptions for the current month" arrow>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Current MRR</Typography>
                      <Typography variant="h4">
                        ${metrics[metrics.length - 1].mrr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </Box>
                  </Tooltip>
                  <Tooltip title="Annual Recurring Revenue - Current MRR × 12" arrow>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Current ARR</Typography>
                      <Typography variant="h4">
                        ${metrics[metrics.length - 1].arr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </Box>
                  </Tooltip>
                  <Tooltip title="Average Contract Value - Total ARR divided by number of active customers" arrow>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Average Contract Value</Typography>
                      <Typography variant="h4">
                        ${metrics[metrics.length - 1].acv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </Box>
                  </Tooltip>
                </Box>

                {/* Secondary Metrics */}
                <Box sx={{ display: 'grid', gap: 3 }}>
                  <Tooltip title="Annual Run Rate - Last quarter's net new revenue × 4 (annualized)" arrow>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Annual Run Rate</Typography>
                      <Typography variant="h4">
                        ${(() => {
                          const lastQuarterMetric = metrics.filter(m => m.formattedQuarter).slice(-1)[0];
                          const annualRunRate = lastQuarterMetric?.netNewRevenue * 4 || 0;
                          return annualRunRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        })()}
                      </Typography>
                    </Box>
                  </Tooltip>
                  <Tooltip title="New Revenue (Annual) - Sum of all positive MRR changes in the last 3 months" arrow>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">New Revenue (Annual)</Typography>
                      <Typography variant="h4">
                        ${(() => {
                          const last3Months = metrics.slice(-3);
                          const quarterlyNewRevenue = last3Months.reduce((sum, m) => sum + m.netNewRevenue, 0);
                          return quarterlyNewRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        })()}
                      </Typography>
                    </Box>
                  </Tooltip>
                </Box>
              </Box>

              {/* Growth & Retention Metrics */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
                <Tooltip title="Quarter-over-Quarter Growth Rate - (Current Quarter ARR - Previous Quarter ARR) / Previous Quarter ARR × 100" arrow>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Growth Rate (Q/Q)</Typography>
                    <Typography variant="h5">
                      {(() => {
                        const lastQuarterMetric = metrics.filter(m => m.quarterlyGrowth !== undefined).slice(-1)[0];
                        return lastQuarterMetric?.quarterlyGrowth?.toFixed(1) || '0.0';
                      })()}%
                    </Typography>
                  </Box>
                </Tooltip>
                <Tooltip title="Monthly Net Revenue Retention - Revenue from existing customers this month / Revenue from same customers last month × 100" arrow>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Monthly NRR</Typography>
                    <Typography variant="h5">
                      {metrics[metrics.length - 1].nrr.toFixed(1)}%
                    </Typography>
                  </Box>
                </Tooltip>
                <Tooltip title="Quarterly Net Revenue Retention - Revenue from existing customers this quarter / Revenue from same customers last quarter × 100" arrow>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Quarterly NRR</Typography>
                    <Typography variant="h5">
                      {(() => {
                        const lastQuarterMetric = metrics.filter(m => m.quarterlyNrr !== undefined).slice(-1)[0];
                        const quarterlyNrr = lastQuarterMetric?.quarterlyNrr;
                        return quarterlyNrr !== undefined ? quarterlyNrr.toFixed(1) : '0.0';
                      })()}%
                    </Typography>
                  </Box>
                </Tooltip>
                <Tooltip title="Annual Net Revenue Retention - Revenue from existing customers this month / Revenue from same customers 12 months ago × 100" arrow>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Annual NRR</Typography>
                    <Typography variant="h5">
                      {(() => {
                        const yearAgoIndex = metrics.length - 13;
                        if (yearAgoIndex < 0) return '0.0';
                        
                        const yearAgoCustomers = new Set(
                          customerData
                            .filter((customer: CustomerData) => {
                              const revenue = cleanCurrencyString(customer[metrics[yearAgoIndex].date]);
                              return revenue > 0;
                            })
                            .map((customer: CustomerData) => customer.Customer)
                        );

                        const yearAgoRevenue = customerData
                          .filter((customer: CustomerData) => yearAgoCustomers.has(customer.Customer))
                          .reduce((sum: number, customer: CustomerData) => {
                            const revenue = cleanCurrencyString(customer[metrics[yearAgoIndex].date]);
                            return sum + revenue;
                          }, 0);

                        const currentRevenueFromYearAgoCustomers = customerData
                          .filter((customer: CustomerData) => yearAgoCustomers.has(customer.Customer))
                          .reduce((sum: number, customer: CustomerData) => {
                            const revenue = cleanCurrencyString(customer[metrics[metrics.length - 1].date]);
                            return sum + revenue;
                          }, 0);

                        return yearAgoRevenue 
                          ? ((currentRevenueFromYearAgoCustomers / yearAgoRevenue) * 100).toFixed(1)
                          : '0.0';
                      })()}%
                    </Typography>
                  </Box>
                </Tooltip>
              </Box>
            </Paper>

            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Monthly Trends
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Toggle Series:
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box>
                    <input
                      type="checkbox"
                      id="monthly-mrr"
                      checked={monthlyVisibleSeries.mrr}
                      onChange={(e) => setMonthlyVisibleSeries(prev => ({ ...prev, mrr: e.target.checked }))}
                    />
                    <label htmlFor="monthly-mrr">MRR</label>
                  </Box>
                  <Box>
                    <input
                      type="checkbox"
                      id="monthly-arr"
                      checked={monthlyVisibleSeries.arr}
                      onChange={(e) => setMonthlyVisibleSeries(prev => ({ ...prev, arr: e.target.checked }))}
                    />
                    <label htmlFor="monthly-arr">ARR</label>
                  </Box>
                  <Box>
                    <input
                      type="checkbox"
                      id="monthly-nrr"
                      checked={monthlyVisibleSeries.nrr}
                      onChange={(e) => setMonthlyVisibleSeries(prev => ({ ...prev, nrr: e.target.checked }))}
                    />
                    <label htmlFor="monthly-nrr">NRR</label>
                  </Box>
                  <Box>
                    <input
                      type="checkbox"
                      id="monthly-acv"
                      checked={monthlyVisibleSeries.acv}
                      onChange={(e) => setMonthlyVisibleSeries(prev => ({ ...prev, acv: e.target.checked }))}
                    />
                    <label htmlFor="monthly-acv">ACV</label>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ height: 400, ml: 2 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics} margin={{ top: 10, right: 50, left: 50, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis 
                      yAxisId="left"
                      tickFormatter={(value) => `$${value.toLocaleString()}`}
                      label={{ value: 'Revenue ($)', angle: -90, position: 'insideLeft', offset: -35 }}
                      width={80}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right"
                      tickFormatter={(value) => `${value}%`}
                      label={{ value: 'NRR (%)', angle: 90, position: 'insideRight', offset: -35 }}
                      width={80}
                    />
                    <RechartsTooltip 
                      formatter={(value: number, name: string) => {
                        if (name === 'MRR' || name === 'ARR' || name === 'ACV') {
                          return [`$${value.toLocaleString()}`, name];
                        }
                        return [`${value.toFixed(1)}%`, name];
                      }}
                    />
                    <Legend />
                    {monthlyVisibleSeries.mrr && (
                      <Line yAxisId="left" type="monotone" dataKey="mrr" name="MRR" stroke="#8884d8" />
                    )}
                    {monthlyVisibleSeries.arr && (
                      <Line yAxisId="left" type="monotone" dataKey="arr" name="ARR" stroke="#82ca9d" />
                    )}
                    {monthlyVisibleSeries.nrr && (
                      <Line yAxisId="right" type="monotone" dataKey="nrr" name="NRR" stroke="#ffc658" />
                    )}
                    {monthlyVisibleSeries.acv && (
                      <Line 
                        yAxisId="left" 
                        type="monotone" 
                        dataKey="acv" 
                        name="ACV" 
                        stroke="#ff7300" 
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Paper>

            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Quarterly Trends
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Toggle Series:
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box>
                    <input
                      type="checkbox"
                      id="quarterly-mrr"
                      checked={quarterlyVisibleSeries.mrr}
                      onChange={(e) => setQuarterlyVisibleSeries(prev => ({ ...prev, mrr: e.target.checked }))}
                    />
                    <label htmlFor="quarterly-mrr">MRR</label>
                  </Box>
                  <Box>
                    <input
                      type="checkbox"
                      id="quarterly-arr"
                      checked={quarterlyVisibleSeries.arr}
                      onChange={(e) => setQuarterlyVisibleSeries(prev => ({ ...prev, arr: e.target.checked }))}
                    />
                    <label htmlFor="quarterly-arr">ARR</label>
                  </Box>
                  <Box>
                    <input
                      type="checkbox"
                      id="quarterly-nrr"
                      checked={quarterlyVisibleSeries.nrr}
                      onChange={(e) => setQuarterlyVisibleSeries(prev => ({ ...prev, nrr: e.target.checked }))}
                    />
                    <label htmlFor="quarterly-nrr">NRR</label>
                  </Box>
                  <Box>
                    <input
                      type="checkbox"
                      id="quarterly-acv"
                      checked={quarterlyVisibleSeries.acv}
                      onChange={(e) => setQuarterlyVisibleSeries(prev => ({ ...prev, acv: e.target.checked }))}
                    />
                    <label htmlFor="quarterly-acv">ACV</label>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ height: 400, ml: 2 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={metrics.filter(m => m.formattedQuarter)}
                    margin={{ top: 10, right: 50, left: 50, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="formattedQuarter" />
                    <YAxis 
                      yAxisId="left"
                      tickFormatter={(value) => `$${value.toLocaleString()}`}
                      label={{ value: 'Revenue ($)', angle: -90, position: 'insideLeft', offset: -35 }}
                      width={80}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right"
                      tickFormatter={(value) => `${value}%`}
                      label={{ value: 'NRR (%)', angle: 90, position: 'insideRight', offset: -35 }}
                      width={80}
                    />
                    <RechartsTooltip 
                      formatter={(value: number, name: string) => {
                        if (name === 'Quarterly MRR' || name === 'Quarterly ARR' || name === 'Quarterly ACV') {
                          return [`$${value.toLocaleString()}`, name];
                        }
                        return [`${value.toFixed(1)}%`, name];
                      }}
                    />
                    <Legend />
                    {quarterlyVisibleSeries.mrr && (
                      <Line 
                        yAxisId="left" 
                        type="monotone" 
                        dataKey="quarterlyMrr" 
                        name="Quarterly MRR" 
                        stroke="#8884d8" 
                      />
                    )}
                    {quarterlyVisibleSeries.arr && (
                      <Line 
                        yAxisId="left" 
                        type="monotone" 
                        dataKey="quarterlyArr" 
                        name="Quarterly ARR" 
                        stroke="#82ca9d" 
                      />
                    )}
                    {quarterlyVisibleSeries.nrr && (
                      <Line 
                        yAxisId="right" 
                        type="monotone" 
                        dataKey="quarterlyNrr" 
                        name="Quarterly NRR" 
                        stroke="#ffc658" 
                      />
                    )}
                    {quarterlyVisibleSeries.acv && (
                      <Line 
                        yAxisId="left" 
                        type="monotone" 
                        dataKey="quarterlyAcv" 
                        name="Quarterly ACV" 
                        stroke="#ff7300" 
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Paper>

            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Cohort Analysis
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Shows revenue retention by cohort. Each cell shows the percentage of initial MRR retained/expanded over time.
              </Typography>
              <CohortGrid data={cohortData} />
            </Paper>

            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Customer Details
              </Typography>
              <Box sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  variant="outlined"
                  label="Search Customers"
                  size="small"
                  onChange={(e) => {
                    const value = e.target.value;
                    const filteredSummaries = value 
                      ? customerSummaries.filter(summary => 
                          summary.customer.toLowerCase().includes(value.toLowerCase())
                        )
                      : customerSummaries;
                    setFilteredCustomers(filteredSummaries);
                  }}
                />
              </Box>
              <Box sx={{ height: 800 }}>
                <DataGrid
                  rows={filteredCustomers}
                  columns={customerColumns}
                  initialState={{
                    pagination: {
                      paginationModel: { pageSize: 25 }
                    },
                    sorting: {
                      sortModel: [{ field: 'startDate', sort: 'desc' }]
                    }
                  }}
                  pageSizeOptions={[5]}
                  disableRowSelectionOnClick
                />
              </Box>
            </Paper>
          </>
        )}
      </Box>
    </Container>
  );
}

export default App;
